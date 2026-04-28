import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, symlinkSync, realpathSync } from "node:fs";
import { join, sep, resolve, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveUserPath,
  resolveInternalPath,
  isPathDenied,
  pathsAreSame,
} from "../../src/core/paths.js";
import { AppError } from "../../src/core/errors.js";
import { makeTmpWorkspace, isCaseSensitiveFs, type TmpWorkspace } from "../helpers/tmpWorkspace.js";

let ws: TmpWorkspace;
beforeEach(() => {
  ws = makeTmpWorkspace();
});
afterEach(() => ws.cleanup());

describe("resolveUserPath", () => {
  it("returns canonical absolute for relative input inside root", () => {
    ws.write("a.txt", "x");
    const out = resolveUserPath("a.txt", ws.config);
    expect(isAbsolute(out)).toBe(true);
    expect(out).toBe(join(ws.root, "a.txt"));
  });

  it("rejects parent traversal escaping root", () => {
    expect(() => resolveUserPath("../../etc/passwd", ws.config)).toThrow(AppError);
    try {
      resolveUserPath("../../etc/passwd", ws.config);
    } catch (e) {
      expect((e as AppError).code).toBe("PATH_OUTSIDE_WORKSPACE");
    }
  });

  it("rejects absolute path outside root", () => {
    const outside = resolve(tmpdir(), "outside.txt");
    try {
      resolveUserPath(outside, ws.config);
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AppError).code).toBe("PATH_OUTSIDE_WORKSPACE");
    }
  });

  it("rejects symlink whose target escapes root", () => {
    const targetDir = realpathSync(tmpdir());
    const targetFile = join(targetDir, "secret-target.txt");
    writeFileSync(targetFile, "secret");
    const linkPath = join(ws.root, "escape-link");
    try {
      symlinkSync(targetFile, linkPath, "file");
    } catch {
      // symlink may require admin on Windows; skip if so
      return;
    }
    try {
      resolveUserPath("escape-link", ws.config);
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AppError).code).toBe("PATH_OUTSIDE_WORKSPACE");
    }
  });

  it("accepts symlink whose target is inside root", () => {
    ws.write("real.txt", "hi");
    const linkPath = join(ws.root, "alias.txt");
    try {
      symlinkSync(join(ws.root, "real.txt"), linkPath, "file");
    } catch {
      return;
    }
    const resolved = resolveUserPath("alias.txt", ws.config);
    expect(resolved.startsWith(ws.root)).toBe(true);
  });

  it("rejects denied paths matching default globs", () => {
    mkdirSync(join(ws.root, ".git"), { recursive: true });
    writeFileSync(join(ws.root, ".git", "config"), "x");
    try {
      resolveUserPath(".git/config", ws.config);
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AppError).code).toBe("PATH_DENIED");
    }

    expect(() => resolveUserPath(".env", ws.config)).toThrow(AppError);
    expect(() => resolveUserPath("nested/.env", ws.config)).toThrow(AppError);
    expect(() => resolveUserPath("keys/cert.pem", ws.config)).toThrow(AppError);
    expect(() => resolveUserPath("keys/private.key", ws.config)).toThrow(AppError);
    expect(() => resolveUserPath("node_modules/foo/bar.js", ws.config)).toThrow(AppError);
  });

  it("rejects custom deny globs additively to defaults", () => {
    const cfg = ws.withEnv({ LINE_MOVER_DENY_GLOBS: "secrets/**,*.token" });
    expect(() => resolveUserPath("secrets/a.txt", cfg)).toThrow(AppError);
    expect(() => resolveUserPath("api.token", cfg)).toThrow(AppError);
    expect(() => resolveUserPath(".git/x", cfg)).toThrow(AppError);
  });

  it("denies paths inside the snapshot dir", () => {
    expect(() => resolveUserPath(".mcp-line-mover/anything.json", ws.config)).toThrow(AppError);
  });

  it("allows paths that do not yet exist", () => {
    const out = resolveUserPath("subdir/new-file.txt", ws.config);
    expect(out).toBe(join(ws.root, "subdir", "new-file.txt"));
  });

  it("realpath fallback when target missing but ancestor escapes still rejects", () => {
    const out = resolveUserPath("a/b/c.txt", ws.config);
    expect(out.startsWith(ws.root + sep) || out === ws.root).toBe(true);
  });

  it("handles paths with spaces and unicode", () => {
    const out = resolveUserPath("with space/úní.txt", ws.config);
    expect(out).toBe(join(ws.root, "with space", "úní.txt"));
  });
});

describe("resolveInternalPath", () => {
  it("workspace-confines but skips denylist", () => {
    const out = resolveInternalPath(".mcp-line-mover/operations/abc.json", ws.config);
    expect(out).toBe(join(ws.root, ".mcp-line-mover", "operations", "abc.json"));
  });

  it("still rejects escapes", () => {
    expect(() => resolveInternalPath("../escape", ws.config)).toThrow(AppError);
  });
});

describe("isPathDenied", () => {
  it.each([
    [".git/config", true],
    ["node_modules/x/y.js", true],
    [".env", true],
    ["foo/.env", true],
    ["a.pem", true],
    ["a/b/c.key", true],
    [".mcp-line-mover/x", true],
    ["src/file.ts", false],
    ["env.example", false],
    ["a.envelope", false],
  ])("matches %s -> %s", (path, expected) => {
    expect(isPathDenied(path, ws.config.denyGlobs)).toBe(expected);
  });
});

describe("pathsAreSame", () => {
  it("returns true for identical strings", () => {
    expect(pathsAreSame(join(ws.root, "a.txt"), join(ws.root, "a.txt"))).toBe(true);
  });

  it("returns false for different files", () => {
    ws.write("a.txt", "x");
    ws.write("b.txt", "y");
    expect(pathsAreSame(join(ws.root, "a.txt"), join(ws.root, "b.txt"))).toBe(false);
  });

  it("returns true via symlink alias when both point at same target", () => {
    ws.write("real.txt", "hi");
    const linkPath = join(ws.root, "alias.txt");
    try {
      symlinkSync(join(ws.root, "real.txt"), linkPath, "file");
    } catch {
      return;
    }
    expect(pathsAreSame(join(ws.root, "real.txt"), linkPath)).toBe(true);
  });

  it.skipIf(isCaseSensitiveFs())(
    "returns true for differing case on case-insensitive FS",
    () => {
      ws.write("Aa.txt", "x");
      expect(pathsAreSame(join(ws.root, "Aa.txt"), join(ws.root, "aA.txt"))).toBe(true);
    },
  );
});
