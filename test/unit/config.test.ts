import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { loadConfig, DEFAULT_DENY_GLOBS, DEFAULT_ROOT_MARKERS } from "../../src/core/config.js";
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
    expect(cfg.fixedRoot).toBeNull();
    expect(cfg.maxLines).toBe(2000);
    expect(cfg.maxFileSizeMb).toBe(5);
    expect(cfg.allowCreate).toBe(false);
    expect(cfg.createParentDirs).toBe(false);
    expect(cfg.snapshotDir).toBe(".mcp-line-mover");
    expect(cfg.operationTtlDays).toBe(14);
    expect(cfg.maxRootWalk).toBe(25);
    expect(cfg.rootMarkers).toEqual([...DEFAULT_ROOT_MARKERS]);
    expect(cfg.registryDir).toBe(join(homedir(), ".mcp-line-mover"));
  });

  it("returns a frozen object", () => {
    const cfg = loadConfig({}, root);
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(Object.isFrozen(cfg.denyGlobs)).toBe(true);
    expect(Object.isFrozen(cfg.rootMarkers)).toBe(true);
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
        LINE_MOVER_MAX_ROOT_WALK: "40",
      },
      root,
    );
    expect(cfg.maxLines).toBe(500);
    expect(cfg.maxFileSizeMb).toBe(10);
    expect(cfg.operationTtlDays).toBe(30);
    expect(cfg.maxRootWalk).toBe(40);
  });

  it("clamps maxRootWalk to hard cap of 100", () => {
    const cfg = loadConfig({ LINE_MOVER_MAX_ROOT_WALK: "9999" }, root);
    expect(cfg.maxRootWalk).toBe(100);
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

  it("ROOT_MARKERS overrides default; order preserved", () => {
    const cfg = loadConfig({ LINE_MOVER_ROOT_MARKERS: "package.json,.git" }, root);
    expect(cfg.rootMarkers).toEqual(["package.json", ".git"]);
  });

  it("ROOT_MARKERS empty string falls back to default", () => {
    const cfg = loadConfig({ LINE_MOVER_ROOT_MARKERS: "" }, root);
    expect(cfg.rootMarkers).toEqual([...DEFAULT_ROOT_MARKERS]);
  });

  it("REGISTRY_DIR overrides default", () => {
    const cfg = loadConfig({ LINE_MOVER_REGISTRY_DIR: "/tmp/x" }, root);
    expect(cfg.registryDir).toBe("/tmp/x");
  });
});

describe("loadConfig root resolution", () => {
  it("fixedRoot is realpath of LINE_MOVER_ROOT when set", () => {
    const cfg = loadConfig({ LINE_MOVER_ROOT: root }, "/some/other/cwd");
    expect(cfg.fixedRoot).toBe(realpathSync(root));
  });

  it("fixedRoot is null when LINE_MOVER_ROOT not set", () => {
    const cfg = loadConfig({}, root);
    expect(cfg.fixedRoot).toBeNull();
  });

  it("fixedRoot is null when LINE_MOVER_ROOT is empty string", () => {
    const cfg = loadConfig({ LINE_MOVER_ROOT: "" }, root);
    expect(cfg.fixedRoot).toBeNull();
  });

  it("rejects when configured root does not exist", () => {
    expect(() =>
      loadConfig({ LINE_MOVER_ROOT: join(root, "does-not-exist") }, root),
    ).toThrow(AppError);
  });
});
