import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, DEFAULT_DENY_GLOBS } from "../../src/core/config.js";
import { AppError } from "../../src/core/errors.js";

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lm-cfg-")));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("loadConfig defaults", () => {
  it("matches spec §13 defaults", () => {
    const cfg = loadConfig({}, root);
    expect(cfg.root).toBe(root);
    expect(cfg.maxLines).toBe(2000);
    expect(cfg.maxFileSizeMb).toBe(5);
    expect(cfg.allowCreate).toBe(false);
    expect(cfg.createParentDirs).toBe(false);
    expect(cfg.snapshotDir).toBe(".mcp-line-mover");
    expect(cfg.operationTtlDays).toBe(14);
  });

  it("returns a frozen object", () => {
    const cfg = loadConfig({}, root);
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(Object.isFrozen(cfg.denyGlobs)).toBe(true);
  });

  it("includes default deny globs", () => {
    const cfg = loadConfig({}, root);
    for (const g of DEFAULT_DENY_GLOBS) {
      expect(cfg.denyGlobs).toContain(g);
    }
  });

  it("auto-includes the snapshot dir in deny globs", () => {
    const cfg = loadConfig({ LINE_MOVER_SNAPSHOT_DIR: ".my-snaps" }, root);
    expect(cfg.denyGlobs).toContain(".my-snaps/**");
  });
});

describe("loadConfig env parsing", () => {
  it("parses numeric env vars", () => {
    const cfg = loadConfig(
      {
        LINE_MOVER_MAX_LINES: "500",
        LINE_MOVER_MAX_FILE_SIZE_MB: "10",
        LINE_MOVER_OPERATION_TTL_DAYS: "30",
      },
      root,
    );
    expect(cfg.maxLines).toBe(500);
    expect(cfg.maxFileSizeMb).toBe(10);
    expect(cfg.operationTtlDays).toBe(30);
  });

  it("rejects non-numeric values without coercing", () => {
    expect(() => loadConfig({ LINE_MOVER_MAX_LINES: "abc" }, root)).toThrow(AppError);
  });

  it("rejects negative values", () => {
    expect(() => loadConfig({ LINE_MOVER_MAX_LINES: "-1" }, root)).toThrow(AppError);
  });

  it("parses boolean env vars", () => {
    const cfg = loadConfig(
      { LINE_MOVER_ALLOW_CREATE: "true", LINE_MOVER_CREATE_PARENT_DIRS: "1" },
      root,
    );
    expect(cfg.allowCreate).toBe(true);
    expect(cfg.createParentDirs).toBe(true);
  });

  it("treats unrecognized boolean strings as false", () => {
    const cfg = loadConfig({ LINE_MOVER_ALLOW_CREATE: "yes-please" }, root);
    expect(cfg.allowCreate).toBe(false);
  });

  it("DENY_GLOBS is additive to defaults, never replacing", () => {
    const cfg = loadConfig({ LINE_MOVER_DENY_GLOBS: "*.secret,extra/**" }, root);
    expect(cfg.denyGlobs).toContain("*.secret");
    expect(cfg.denyGlobs).toContain("extra/**");
    for (const g of DEFAULT_DENY_GLOBS) expect(cfg.denyGlobs).toContain(g);
  });

  it("trims and ignores empty entries in DENY_GLOBS", () => {
    const cfg = loadConfig({ LINE_MOVER_DENY_GLOBS: "  *.x , , y/** " }, root);
    expect(cfg.denyGlobs).toContain("*.x");
    expect(cfg.denyGlobs).toContain("y/**");
    expect(cfg.denyGlobs).not.toContain("");
  });
});

describe("loadConfig root resolution", () => {
  it("realpaths the configured root", () => {
    const cfg = loadConfig({ LINE_MOVER_ROOT: root }, "/some/other/cwd");
    expect(cfg.root).toBe(realpathSync(root));
  });

  it("uses fallback cwd when LINE_MOVER_ROOT not set", () => {
    const cfg = loadConfig({}, root);
    expect(cfg.root).toBe(root);
  });

  it("rejects when configured root does not exist", () => {
    expect(() =>
      loadConfig({ LINE_MOVER_ROOT: join(root, "does-not-exist") }, root),
    ).toThrow(AppError);
  });
});
