import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, readFileSync, symlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  readTextFile,
  writeAtomic,
  detectEol,
  serializeLines,
} from "../../src/core/files.js";
import { AppError } from "../../src/core/errors.js";
import { makeTmpWorkspace, type TmpWorkspace } from "../helpers/tmpWorkspace.js";

let ws: TmpWorkspace;
beforeEach(() => {
  ws = makeTmpWorkspace();
});
afterEach(() => ws.cleanup());

describe("detectEol", () => {
  it("returns CRLF for files starting with CRLF", () => {
    expect(detectEol(Buffer.from("a\r\nb\nc"))).toBe("\r\n");
  });
  it("returns LF for files with LF", () => {
    expect(detectEol(Buffer.from("a\nb"))).toBe("\n");
  });
  it("returns LF default for terminator-less files", () => {
    expect(detectEol(Buffer.from("abc"))).toBe("\n");
  });
  it("returns LF for empty file", () => {
    expect(detectEol(Buffer.from(""))).toBe("\n");
  });
});

describe("serializeLines", () => {
  it("joins with eol and applies finalNewline", () => {
    expect(serializeLines(["a", "b"], "\n", true)).toBe("a\nb\n");
    expect(serializeLines(["a", "b"], "\n", false)).toBe("a\nb");
    expect(serializeLines(["a", "b"], "\r\n", true)).toBe("a\r\nb\r\n");
  });
  it("handles empty file", () => {
    expect(serializeLines([], "\n", false)).toBe("");
    expect(serializeLines([], "\n", true)).toBe("");
  });
  it("handles single line", () => {
    expect(serializeLines(["x"], "\n", true)).toBe("x\n");
  });
});

describe("readTextFile", () => {
  it("returns lines without terminators, eol, finalNewline", () => {
    ws.write("a.txt", "line1\nline2\nline3\n");
    const r = readTextFile(join(ws.root, "a.txt"), ws.config);
    expect(r.lines).toEqual(["line1", "line2", "line3"]);
    expect(r.eol).toBe("\n");
    expect(r.finalNewline).toBe(true);
  });

  it("preserves CRLF detection", () => {
    ws.write("a.txt", "line1\r\nline2\r\n");
    const r = readTextFile(join(ws.root, "a.txt"), ws.config);
    expect(r.lines).toEqual(["line1", "line2"]);
    expect(r.eol).toBe("\r\n");
    expect(r.finalNewline).toBe(true);
  });

  it("detects missing final newline", () => {
    ws.write("a.txt", "line1\nline2");
    const r = readTextFile(join(ws.root, "a.txt"), ws.config);
    expect(r.lines).toEqual(["line1", "line2"]);
    expect(r.finalNewline).toBe(false);
  });

  it("empty file gives empty lines and finalNewline=false", () => {
    ws.write("e.txt", "");
    const r = readTextFile(join(ws.root, "e.txt"), ws.config);
    expect(r.lines).toEqual([]);
    expect(r.finalNewline).toBe(false);
  });

  it("rejects binary file (NUL byte)", () => {
    writeFileSync(join(ws.root, "bin.dat"), Buffer.from([0x48, 0x00, 0x49]));
    try {
      readTextFile(join(ws.root, "bin.dat"), ws.config);
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AppError).code).toBe("BINARY_FILE_REJECTED");
    }
  });

  it("rejects file exceeding maxFileSizeMb", () => {
    const cfg = ws.withEnv({ LINE_MOVER_MAX_FILE_SIZE_MB: "1" });
    const big = Buffer.alloc(2 * 1024 * 1024, 0x41);
    writeFileSync(join(ws.root, "big.txt"), big);
    try {
      readTextFile(join(ws.root, "big.txt"), cfg);
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AppError).code).toBe("FILE_TOO_LARGE");
    }
  });

  it("returns SOURCE_NOT_FOUND for missing file", () => {
    try {
      readTextFile(join(ws.root, "missing.txt"), ws.config);
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AppError).code).toBe("SOURCE_NOT_FOUND");
    }
  });
});

describe("writeAtomic round-trip", () => {
  it("LF round-trip is byte-identical", () => {
    const content = "a\nb\nc\n";
    ws.write("rt.txt", content);
    const r = readTextFile(join(ws.root, "rt.txt"), ws.config);
    writeAtomic(join(ws.root, "rt.txt"), serializeLines(r.lines, r.eol, r.finalNewline));
    expect(readFileSync(join(ws.root, "rt.txt"), "utf8")).toBe(content);
  });

  it("CRLF round-trip is byte-identical", () => {
    const content = "a\r\nb\r\nc\r\n";
    ws.write("rt.txt", content);
    const r = readTextFile(join(ws.root, "rt.txt"), ws.config);
    writeAtomic(join(ws.root, "rt.txt"), serializeLines(r.lines, r.eol, r.finalNewline));
    expect(readFileSync(join(ws.root, "rt.txt"), "utf8")).toBe(content);
  });

  it("no-trailing-newline round-trip preserves absence", () => {
    const content = "a\nb";
    ws.write("rt.txt", content);
    const r = readTextFile(join(ws.root, "rt.txt"), ws.config);
    writeAtomic(join(ws.root, "rt.txt"), serializeLines(r.lines, r.eol, r.finalNewline));
    expect(readFileSync(join(ws.root, "rt.txt"), "utf8")).toBe(content);
  });

  it("creates parent directories when asked", () => {
    writeAtomic(join(ws.root, "deep/inner/file.txt"), "x", { mkdirs: true });
    expect(readFileSync(join(ws.root, "deep/inner/file.txt"), "utf8")).toBe("x");
  });

  it("writes through symlink, preserving the link", () => {
    ws.write("real.txt", "old");
    const linkPath = join(ws.root, "alias.txt");
    try {
      symlinkSync(join(ws.root, "real.txt"), linkPath, "file");
    } catch {
      return;
    }
    writeAtomic(linkPath, "new");
    expect(readFileSync(join(ws.root, "real.txt"), "utf8")).toBe("new");
    expect(statSync(linkPath, { bigint: false }).isFile()).toBe(true);
  });
});
