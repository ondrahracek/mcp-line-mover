import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, symlinkSync, rmSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, sep } from "node:path";
import {
  findMarkedRoot,
  resolveWorkspaceForPaths,
} from "../../src/core/workspace.js";
import { loadConfig } from "../../src/core/config.js";
import { AppError } from "../../src/core/errors.js";
import { makeTmpWorkspace, type TmpWorkspace } from "../helpers/tmpWorkspace.js";
import * as os from "node:os";

let ws: TmpWorkspace;
beforeEach(() => {
  ws = makeTmpWorkspace();
});
afterEach(() => ws.cleanup());

describe("findMarkedRoot", () => {
  it("returns dir containing marker (.git directory)", () => {
    mkdirSync(join(ws.root, ".git"), { recursive: true });
    const inner = join(ws.root, "src", "foo");
    mkdirSync(inner, { recursive: true });
    expect(findMarkedRoot(inner, [".git"], 25)).toBe(ws.root);
  });

  it("accepts .git as a file (worktree style)", () => {
    writeFileSync(join(ws.root, ".git"), "gitdir: /elsewhere\n");
    const inner = join(ws.root, "src");
    mkdirSync(inner, { recursive: true });
    expect(findMarkedRoot(inner, [".git"], 25)).toBe(ws.root);
  });

  it("returns null when no marker found", () => {
    const inner = join(ws.root, "src");
    mkdirSync(inner, { recursive: true });
    expect(findMarkedRoot(inner, [".git"], 25)).toBeNull();
  });

  it("returns the deepest matching ancestor (first match wins on walk-up)", () => {
    mkdirSync(join(ws.root, ".git"), { recursive: true });
    const middle = join(ws.root, "middle");
    mkdirSync(join(middle, ".git"), { recursive: true });
    const inner = join(middle, "deeper");
    mkdirSync(inner, { recursive: true });
    expect(findMarkedRoot(inner, [".git"], 25)).toBe(middle);
  });

  it("respects maxWalk depth limit", () => {
    mkdirSync(join(ws.root, ".git"), { recursive: true });
    const deep = join(ws.root, "a", "b", "c", "d", "e");
    mkdirSync(deep, { recursive: true });
    expect(findMarkedRoot(deep, [".git"], 2)).toBeNull();
    expect(findMarkedRoot(deep, [".git"], 25)).toBe(ws.root);
  });

  it("multiple markers: first match (closer) wins regardless of marker order", () => {
    mkdirSync(join(ws.root, ".git"), { recursive: true });
    const middle = join(ws.root, "middle");
    mkdirSync(middle, { recursive: true });
    writeFileSync(join(middle, "package.json"), "{}");
    const inner = join(middle, "src");
    mkdirSync(inner, { recursive: true });
    expect(findMarkedRoot(inner, ["package.json", ".git"], 25)).toBe(middle);
    expect(findMarkedRoot(inner, [".git", "package.json"], 25)).toBe(middle);
  });

  it("ignores marker with same name when it is the wrong type for the check", () => {
    // any-existing matches our marker check, so a file named .git counts (worktree)
    writeFileSync(join(ws.root, ".git"), "x");
    const inner = join(ws.root, "deep");
    mkdirSync(inner, { recursive: true });
    expect(findMarkedRoot(inner, [".git"], 25)).toBe(ws.root);
  });

  it("starting from the marker dir itself returns that dir", () => {
    mkdirSync(join(ws.root, ".git"), { recursive: true });
    expect(findMarkedRoot(ws.root, [".git"], 25)).toBe(ws.root);
  });

  it("walks up from a missing path's existing parent", () => {
    mkdirSync(join(ws.root, ".git"), { recursive: true });
    const missing = join(ws.root, "src", "doesnt-yet-exist.ts");
    expect(findMarkedRoot(missing, [".git"], 25)).toBe(ws.root);
  });
});

describe("resolveWorkspaceForPaths — fixed root mode", () => {
  it("returns fixedRoot regardless of inputs when set", () => {
    const cfg = ws.config;
    const result = resolveWorkspaceForPaths([join(ws.root, "anything.txt")], cfg);
    expect(result.root).toBe(ws.root);
    expect(result.inferred).toBe(false);
  });

  it("does not require markers when fixedRoot is set", () => {
    const result = resolveWorkspaceForPaths([join(ws.root, "x.txt")], ws.config);
    expect(result.inferred).toBe(false);
  });
});

describe("resolveWorkspaceForPaths — inferred mode", () => {
  let outerTmp: string;
  let repoA: string;
  let repoB: string;

  beforeEach(() => {
    outerTmp = realpathSync(mkdtempSync(join(tmpdir(), "lm-multi-")));
    repoA = join(outerTmp, "repos", "a");
    repoB = join(outerTmp, "repos", "b");
    mkdirSync(join(repoA, ".git"), { recursive: true });
    mkdirSync(join(repoB, ".git"), { recursive: true });
  });
  afterEach(() => {
    rmSync(outerTmp, { recursive: true, force: true });
  });

  function inferredConfig(extra: Record<string, string | undefined> = {}) {
    return loadConfig(
      {
        LINE_MOVER_REGISTRY_DIR: join(outerTmp, ".registry"),
        ...extra,
      },
      outerTmp,
    );
  }

  it("infers root for paths inside a marked repo", () => {
    const cfg = inferredConfig();
    const result = resolveWorkspaceForPaths([join(repoA, "src", "foo.ts")], cfg);
    expect(result.root).toBe(repoA);
    expect(result.inferred).toBe(true);
  });

  it("rejects when source and dest infer to different roots", () => {
    const cfg = inferredConfig();
    try {
      resolveWorkspaceForPaths(
        [join(repoA, "x.ts"), join(repoB, "y.ts")],
        cfg,
      );
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AppError).code).toBe("PATH_OUTSIDE_WORKSPACE");
    }
  });

  it("rejects when a path has no inferable root", () => {
    const cfg = inferredConfig();
    const orphan = join(outerTmp, "no-marker", "x.ts");
    mkdirSync(join(outerTmp, "no-marker"), { recursive: true });
    try {
      resolveWorkspaceForPaths([orphan], cfg);
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AppError).code).toBe("PATH_OUTSIDE_WORKSPACE");
      expect((e as AppError).recommendedAction).toMatch(/marker|LINE_MOVER_ROOT/);
    }
  });

  it("rejects when inferred root equals os.homedir()", () => {
    // Create a fake "home" via env override; resolveWorkspaceForPaths reads homedir() at call time.
    const fakeHome = realpathSync(mkdtempSync(join(tmpdir(), "lm-fake-home-")));
    mkdirSync(join(fakeHome, ".git"), { recursive: true });
    const origHome = process.env.USERPROFILE ?? process.env.HOME;
    if (process.platform === "win32") {
      process.env.USERPROFILE = fakeHome;
    } else {
      process.env.HOME = fakeHome;
    }
    try {
      const cfg = inferredConfig();
      const inner = join(fakeHome, "deep");
      mkdirSync(inner, { recursive: true });
      try {
        resolveWorkspaceForPaths([join(inner, "x.ts")], cfg);
        expect.fail("should have thrown");
      } catch (e) {
        expect((e as AppError).code).toBe("PATH_OUTSIDE_WORKSPACE");
      }
    } finally {
      if (process.platform === "win32") {
        if (origHome === undefined) delete process.env.USERPROFILE;
        else process.env.USERPROFILE = origHome;
      } else {
        if (origHome === undefined) delete process.env.HOME;
        else process.env.HOME = origHome;
      }
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("supports custom markers via LINE_MOVER_ROOT_MARKERS", () => {
    const projectRoot = join(outerTmp, "node-only");
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "package.json"), "{}");
    const cfg = inferredConfig({ LINE_MOVER_ROOT_MARKERS: "package.json" });
    const result = resolveWorkspaceForPaths([join(projectRoot, "src", "x.ts")], cfg);
    expect(result.root).toBe(projectRoot);
  });

  it("walks up from realpath, not the as-given path (symlinks)", () => {
    const linked = join(outerTmp, "linked-into-a");
    try {
      symlinkSync(join(repoA, "src"), linked, "dir");
    } catch {
      return;
    }
    mkdirSync(join(repoA, "src"), { recursive: true });
    const cfg = inferredConfig();
    const result = resolveWorkspaceForPaths([join(linked, "x.ts")], cfg);
    expect(result.root).toBe(repoA);
  });
});
