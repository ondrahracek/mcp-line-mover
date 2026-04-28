import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { AppError } from "../core/errors.js";
import type { Config } from "../core/config.js";
import { resolveUserPath, pathsAreSame } from "../core/paths.js";
import { readTextFile, parseTextBytes, type ParsedFile } from "../core/files.js";
import { hashRange, sha256, EMPTY_SHA256 } from "../core/hash.js";
import { validateRange, validateDestLine } from "../core/lineMath.js";
import type { MoveInput } from "../schemas.js";

export interface ValidatedMove {
  input: Required<Omit<MoveInput, "description">> & { description?: string };
  sourceAbs: string;
  destAbs: string;
  sourceFile: ParsedFile;
  destFile: ParsedFile;
  destExisted: boolean;
  sourceFileHash: string;
  destFileHash: string;
  rangeHash: string;
  movedLineCount: number;
}

export function validateMove(rawInput: MoveInput, config: Config): ValidatedMove {
  const placement = rawInput.placement ?? "after";
  const remove_from_source = rawInput.remove_from_source ?? true;
  const create_dest_if_missing = rawInput.create_dest_if_missing ?? config.allowCreate;
  const create_parent_dirs = rawInput.create_parent_dirs ?? config.createParentDirs;

  const sourceAbs = resolveUserPath(rawInput.source_path, config);
  const destAbs = resolveUserPath(rawInput.dest_path, config);

  if (rawInput.source_path === rawInput.dest_path || pathsAreSame(sourceAbs, destAbs)) {
    throw new AppError(
      "SAME_FILE_MOVE_UNSUPPORTED",
      "Same-file moves are not supported in this version",
      {
        details: { source_path: rawInput.source_path, dest_path: rawInput.dest_path },
        recommendedAction: "use distinct source and dest paths",
      },
    );
  }

  const sourceFile = readTextFile(sourceAbs, config);

  let destFile: ParsedFile;
  let destExisted = true;
  if (existsSync(destAbs)) {
    destFile = readTextFile(destAbs, config);
  } else {
    if (!create_dest_if_missing) {
      throw new AppError(
        "DEST_NOT_FOUND",
        `Destination file not found: ${rawInput.dest_path}`,
        {
          details: { path: rawInput.dest_path },
          recommendedAction: "set create_dest_if_missing=true to create it",
        },
      );
    }
    if (!existsSync(dirname(destAbs)) && !create_parent_dirs) {
      throw new AppError(
        "DEST_NOT_FOUND",
        `Destination parent directory does not exist: ${dirname(rawInput.dest_path)}`,
        {
          recommendedAction: "set create_parent_dirs=true to create them",
        },
      );
    }
    destFile = parseTextBytes(Buffer.alloc(0));
    destExisted = false;
  }

  validateRange(rawInput.start_line, rawInput.end_line, sourceFile.lines.length);
  validateDestLine(rawInput.dest_line, destFile.lines.length, placement);

  const movedLineCount = rawInput.end_line - rawInput.start_line + 1;
  if (movedLineCount > config.maxLines) {
    throw new AppError(
      "RANGE_TOO_LARGE",
      `Range of ${movedLineCount} lines exceeds maximum ${config.maxLines}`,
      {
        details: { moved_line_count: movedLineCount, max: config.maxLines },
      },
    );
  }

  const sourceFileHash = sha256(sourceFile.bytes);
  const destFileHash = destExisted ? sha256(destFile.bytes) : EMPTY_SHA256;
  const rangeHash = hashRange(
    sourceFile.lines,
    rawInput.start_line,
    rawInput.end_line,
    sourceFile.eol,
  );

  return {
    input: {
      source_path: rawInput.source_path,
      start_line: rawInput.start_line,
      end_line: rawInput.end_line,
      dest_path: rawInput.dest_path,
      dest_line: rawInput.dest_line,
      placement,
      remove_from_source,
      create_dest_if_missing,
      create_parent_dirs,
      ...(rawInput.description !== undefined ? { description: rawInput.description } : {}),
    },
    sourceAbs,
    destAbs,
    sourceFile,
    destFile,
    destExisted,
    sourceFileHash,
    destFileHash,
    rangeHash,
    movedLineCount,
  };
}
