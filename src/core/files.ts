import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, basename, join } from "node:path";
import { randomBytes } from "node:crypto";
import { AppError } from "./errors.js";
import type { Config } from "./config.js";

export type Eol = "\n" | "\r\n";

export interface ParsedFile {
  bytes: Buffer;
  lines: string[];
  eol: Eol;
  finalNewline: boolean;
}

export function detectEol(bytes: Buffer): Eol {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0a) {
      return i > 0 && bytes[i - 1] === 0x0d ? "\r\n" : "\n";
    }
  }
  return "\n";
}

export function serializeLines(lines: readonly string[], eol: Eol, finalNewline: boolean): string {
  if (lines.length === 0) return "";
  return lines.join(eol) + (finalNewline ? eol : "");
}

export function readTextFile(absPath: string, config: Config): ParsedFile {
  let bytes: Buffer;
  try {
    const stat = statSync(absPath);
    if (!stat.isFile()) {
      throw new AppError("SOURCE_NOT_FOUND", `Not a regular file: ${absPath}`);
    }
    const limit = config.maxFileSizeMb * 1024 * 1024;
    if (stat.size > limit) {
      throw new AppError(
        "FILE_TOO_LARGE",
        `File ${absPath} exceeds maximum size of ${config.maxFileSizeMb} MB`,
        {
          details: { path: absPath, size: stat.size, limit },
          recommendedAction: "increase LINE_MOVER_MAX_FILE_SIZE_MB or skip this file",
        },
      );
    }
    bytes = readFileSync(absPath);
  } catch (err) {
    if (err instanceof AppError) throw err;
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new AppError("SOURCE_NOT_FOUND", `File not found: ${absPath}`, {
        details: { path: absPath },
      });
    }
    throw new AppError("SOURCE_NOT_FOUND", `Cannot read file: ${absPath}`, {
      details: { path: absPath },
      cause: err,
    });
  }

  const probeLen = Math.min(bytes.length, 8192);
  for (let i = 0; i < probeLen; i++) {
    if (bytes[i] === 0x00) {
      throw new AppError("BINARY_FILE_REJECTED", `Binary file rejected: ${absPath}`, {
        details: { path: absPath },
        recommendedAction: "only text files are supported",
      });
    }
  }

  return parseTextBytes(bytes);
}

export function parseTextBytes(bytes: Buffer): ParsedFile {
  const text = bytes.toString("utf8");
  const eol = detectEol(bytes);
  if (text.length === 0) {
    return { bytes, lines: [], eol, finalNewline: false };
  }
  const finalNewline = text.endsWith("\n");
  const body = finalNewline ? text.slice(0, -1) : text;
  const normalized = eol === "\r\n" ? body.replace(/\r$/, "") : body;
  const lines = normalized.split(eol === "\r\n" ? "\r\n" : "\n");
  return { bytes, lines, eol, finalNewline };
}

export interface WriteOptions {
  mkdirs?: boolean;
}

export function writeAtomic(absPath: string, content: string | Buffer, opts: WriteOptions = {}): void {
  const target = resolveSymlinkTarget(absPath);
  const dir = dirname(target);
  if (opts.mkdirs) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch (err) {
      throw new AppError("WRITE_FAILED", `Cannot create directory ${dir}`, {
        details: { dir },
        cause: err,
      });
    }
  }
  const tmp = join(dir, `.${basename(target)}.tmp-${randomBytes(6).toString("hex")}`);
  let fd: number | undefined;
  try {
    fd = openSync(tmp, "w");
    const buf = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    writeSync(fd, buf);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmp, target);
  } catch (err) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
    try {
      unlinkSync(tmp);
    } catch {
      // ignore
    }
    throw new AppError("WRITE_FAILED", `Failed to write ${absPath}`, {
      details: { path: absPath },
      cause: err,
    });
  }
}

function resolveSymlinkTarget(absPath: string): string {
  try {
    return realpathSync(absPath);
  } catch {
    return absPath;
  }
}
