import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, realpathSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type Config } from "../../src/core/config.js";
import { createOperation } from "../../src/core/operations.js";
import { registerRoot } from "../../src/core/registry.js";
import {
  locateOperation,
  locateMostRecentExecutedOperation,
} from "../../src/core/operationLocator.js";
import { AppError } from "../../src/core/errors.js";

let outerTmp: string;
let registryDir: string;
let repoA: string;
let repoB: string;
let cfg: Config;

beforeEach(() => {
  outerTmp = realpathSync(mkdtempSync(join(tmpdir(), "lm-loc-")));
  registryDir = join(outerTmp, "reg");
  repoA = join(outerTmp, "a");
  repoB = join(outerTmp, "b");
  mkdirSync(join(repoA, ".git"), { recursive: true });
  mkdirSync(join(repoB, ".git"), { recursive: true });
  cfg = loadConfig({ LINE_MOVER_REGISTRY_DIR: registryDir }, outerTmp);
});
afterEach(() => {
  rmSync(outerTmp, { recursive: true, force: true });
});

function makeOp(root: string) {
  return createOperation(
    {
      description: "x",
      source_path: "a.txt",
      start_line: 1,
      end_line: 1,
      dest_path: "b.txt",
      dest_line: 1,
      placement: "after",
      remove_from_source: true,
      create_dest_if_missing: false,
      create_parent_dirs: false,
      moved_line_count: 1,
      source_file_hash_before: "h1",
      dest_file_hash_before: "h2",
      selected_range_hash_before: "h3",
      warnings: [],
    },
    root,
    cfg,
  );
}

describe("locateOperation", () => {
  it("finds op via cwd inference when cwd is in a marked repo", () => {
    const op = makeOp(repoA);
    const origCwd = process.cwd();
    process.chdir(repoA);
    try {
      const located = locateOperation(op.operation_id, cfg);
      expect(located.workspace.root).toBe(repoA);
      expect(located.record.operation_id).toBe(op.operation_id);
    } finally {
      process.chdir(origCwd);
    }
  });

  it("falls back to registry when cwd cannot infer", () => {
    const op = makeOp(repoA);
    registerRoot(repoA, cfg);
    const located = locateOperation(op.operation_id, cfg);
    expect(located.workspace.root).toBe(repoA);
    expect(located.record.operation_id).toBe(op.operation_id);
  });

  it("throws OPERATION_NOT_FOUND when id is unknown everywhere", () => {
    expect(() => locateOperation("NOSUCH", cfg)).toThrow(AppError);
    try {
      locateOperation("NOSUCH", cfg);
    } catch (e) {
      expect((e as AppError).code).toBe("OPERATION_NOT_FOUND");
    }
  });

  it("uses fixedRoot exclusively when set", () => {
    const op = makeOp(repoA);
    const fixedCfg = loadConfig(
      { LINE_MOVER_ROOT: repoA, LINE_MOVER_REGISTRY_DIR: registryDir },
      outerTmp,
    );
    const located = locateOperation(op.operation_id, fixedCfg);
    expect(located.workspace.root).toBe(repoA);
    expect(located.workspace.inferred).toBe(false);
  });

  it("fixedRoot mode rejects ids that exist only in registered roots", () => {
    makeOp(repoA);
    const fixedCfg = loadConfig(
      { LINE_MOVER_ROOT: repoB, LINE_MOVER_REGISTRY_DIR: registryDir },
      outerTmp,
    );
    expect(() => locateOperation("anyid", fixedCfg)).toThrow(AppError);
  });
});

describe("locateMostRecentExecutedOperation", () => {
  it("returns null/throws when no executed ops anywhere", () => {
    expect(() => locateMostRecentExecutedOperation(cfg)).toThrow(AppError);
  });
});
