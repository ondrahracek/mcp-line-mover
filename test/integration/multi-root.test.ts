import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type Config } from "../../src/core/config.js";
import { previewMoveLines } from "../../src/tools/previewMoveLines.js";
import { executeOperation } from "../../src/tools/executeOperation.js";
import { moveLines } from "../../src/tools/moveLines.js";
import { undoOperation } from "../../src/tools/undoOperation.js";

let outerTmp: string;
let registryDir: string;
let repoA: string;
let repoB: string;
let cfg: Config;

beforeEach(() => {
  outerTmp = realpathSync(mkdtempSync(join(tmpdir(), "lm-multi-")));
  registryDir = join(outerTmp, "reg");
  repoA = join(outerTmp, "a");
  repoB = join(outerTmp, "b");
  mkdirSync(join(repoA, ".git"), { recursive: true });
  mkdirSync(join(repoB, ".git"), { recursive: true });
  writeFileSync(join(repoA, "src.txt"), "A1\nA2\nA3\n");
  writeFileSync(join(repoA, "dest.txt"), "X\n");
  writeFileSync(join(repoB, "src.txt"), "B1\nB2\n");
  writeFileSync(join(repoB, "dest.txt"), "Y\n");
  cfg = loadConfig({ LINE_MOVER_REGISTRY_DIR: registryDir }, outerTmp);
});
afterEach(() => {
  rmSync(outerTmp, { recursive: true, force: true });
});

describe("inferred-root mode (no LINE_MOVER_ROOT)", () => {
  it("preview + execute work via inferred root from absolute paths", () => {
    const p = previewMoveLines(
      {
        source_path: join(repoA, "src.txt"),
        start_line: 1,
        end_line: 2,
        dest_path: join(repoA, "dest.txt"),
        dest_line: 1,
        placement: "after",
        remove_from_source: true,
      },
      cfg,
    );
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const e = executeOperation({ operation_id: p.operation_id }, cfg);
    expect(e.ok).toBe(true);
    expect(readFileSync(join(repoA, "src.txt"), "utf8")).toBe("A3\n");
    expect(readFileSync(join(repoA, "dest.txt"), "utf8")).toBe("X\nA1\nA2\n");
    expect(existsSync(join(repoA, ".mcp-line-mover", "snapshots", p.operation_id))).toBe(true);
  });

  it("rejects cross-repo move when source and dest infer different roots", () => {
    const p = previewMoveLines(
      {
        source_path: join(repoA, "src.txt"),
        start_line: 1,
        end_line: 1,
        dest_path: join(repoB, "dest.txt"),
        dest_line: 1,
        placement: "after",
        remove_from_source: true,
      },
      cfg,
    );
    expect(p.ok).toBe(false);
    if (p.ok) return;
    expect(p.error_code).toBe("PATH_OUTSIDE_WORKSPACE");
  });

  it("rejects when neither path has an inferable root", () => {
    const orphan = join(outerTmp, "orphan");
    mkdirSync(orphan);
    writeFileSync(join(orphan, "x.txt"), "x\n");
    writeFileSync(join(orphan, "y.txt"), "y\n");
    const p = previewMoveLines(
      {
        source_path: join(orphan, "x.txt"),
        start_line: 1,
        end_line: 1,
        dest_path: join(orphan, "y.txt"),
        dest_line: 1,
        placement: "after",
        remove_from_source: true,
      },
      cfg,
    );
    expect(p.ok).toBe(false);
    if (p.ok) return;
    expect(p.error_code).toBe("PATH_OUTSIDE_WORKSPACE");
    expect(p.recommended_action).toBeDefined();
  });

  it("registers root after successful preview; locator finds op without cwd inference", () => {
    const p = previewMoveLines(
      {
        source_path: join(repoA, "src.txt"),
        start_line: 1,
        end_line: 1,
        dest_path: join(repoA, "dest.txt"),
        dest_line: 1,
        placement: "after",
      },
      cfg,
    );
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(readFileSync(join(registryDir, "roots.log"), "utf8")).toContain(repoA);
    // Now build a fresh config; execute should still find the op via the persisted registry.
    const cfg2 = loadConfig({ LINE_MOVER_REGISTRY_DIR: registryDir }, outerTmp);
    const e = executeOperation({ operation_id: p.operation_id }, cfg2);
    expect(e.ok).toBe(true);
  });

  it("undo finds the op across roots via registry", () => {
    const m = moveLines(
      {
        source_path: join(repoA, "src.txt"),
        start_line: 1,
        end_line: 1,
        dest_path: join(repoA, "dest.txt"),
        dest_line: 1,
        placement: "after",
      },
      cfg,
    );
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    const cfg2 = loadConfig({ LINE_MOVER_REGISTRY_DIR: registryDir }, outerTmp);
    const u = undoOperation({ operation_id: m.operation_id }, cfg2);
    expect(u.ok).toBe(true);
    expect(readFileSync(join(repoA, "src.txt"), "utf8")).toBe("A1\nA2\nA3\n");
    expect(readFileSync(join(repoA, "dest.txt"), "utf8")).toBe("X\n");
  });

  it("undo with no operation_id finds the most recent executed op via registry", () => {
    const m = moveLines(
      {
        source_path: join(repoA, "src.txt"),
        start_line: 1,
        end_line: 1,
        dest_path: join(repoA, "dest.txt"),
        dest_line: 1,
        placement: "after",
      },
      cfg,
    );
    expect(m.ok).toBe(true);
    const cfg2 = loadConfig({ LINE_MOVER_REGISTRY_DIR: registryDir }, outerTmp);
    const u = undoOperation({}, cfg2);
    expect(u.ok).toBe(true);
  });

  it("LINE_MOVER_ROOT keeps single-root mode (no registry write)", () => {
    const fixedCfg = loadConfig(
      { LINE_MOVER_ROOT: repoA, LINE_MOVER_REGISTRY_DIR: registryDir },
      outerTmp,
    );
    const p = previewMoveLines(
      {
        source_path: "src.txt",
        start_line: 1,
        end_line: 1,
        dest_path: "dest.txt",
        dest_line: 1,
        placement: "after",
      },
      fixedCfg,
    );
    expect(p.ok).toBe(true);
    expect(existsSync(join(registryDir, "roots.log"))).toBe(false);
  });

  it("supports custom marker (package.json)", () => {
    const proj = join(outerTmp, "proj");
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, "package.json"), "{}");
    writeFileSync(join(proj, "a.txt"), "X\nY\n");
    writeFileSync(join(proj, "b.txt"), "Z\n");
    const cfgPkg = loadConfig(
      {
        LINE_MOVER_REGISTRY_DIR: registryDir,
        LINE_MOVER_ROOT_MARKERS: "package.json,.git",
      },
      outerTmp,
    );
    const p = previewMoveLines(
      {
        source_path: join(proj, "a.txt"),
        start_line: 1,
        end_line: 1,
        dest_path: join(proj, "b.txt"),
        dest_line: 1,
        placement: "after",
      },
      cfgPkg,
    );
    expect(p.ok).toBe(true);
  });
});
