import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { previewMoveLines } from "../../src/tools/previewMoveLines.js";
import { executeOperation } from "../../src/tools/executeOperation.js";
import { loadOperation } from "../../src/core/operations.js";
import { sha256 } from "../../src/core/hash.js";
import { assertNoLeakedContent } from "../helpers/assertNoLeakedContent.js";
import { makeTmpWorkspace, type TmpWorkspace } from "../helpers/tmpWorkspace.js";

let ws: TmpWorkspace;
beforeEach(() => {
  ws = makeTmpWorkspace();
});
afterEach(() => ws.cleanup());

const tenLines = Array.from({ length: 10 }, (_, i) => `S${i + 1}`).join("\n") + "\n";

function preview(opts: Partial<Parameters<typeof previewMoveLines>[0] & object> = {}) {
  const out = previewMoveLines(
    {
      source_path: "a.txt",
      start_line: 2,
      end_line: 4,
      dest_path: "b.txt",
      dest_line: 1,
      placement: "after",
      remove_from_source: true,
      ...opts,
    },
    ws.config,
  );
  if (!out.ok) throw new Error(`preview failed: ${out.error_code}`);
  return out;
}

describe("executeOperation happy path", () => {
  beforeEach(() => {
    ws.write("a.txt", tenLines);
    ws.write("b.txt", "X1\nX2\n");
  });

  it("applies move and returns metadata", () => {
    const p = preview();
    const r = executeOperation({ operation_id: p.operation_id }, ws.config);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.files_changed).toContain(join(ws.root, "a.txt"));
    expect(r.files_changed).toContain(join(ws.root, "b.txt"));
    expect(r.moved_line_count).toBe(3);
    expect(r.undo_available).toBe(true);
  });

  it("source has the range removed; dest has it inserted", () => {
    const p = preview();
    executeOperation({ operation_id: p.operation_id }, ws.config);
    const a = ws.read("a.txt").toString();
    const b = ws.read("b.txt").toString();
    expect(a).toBe(["S1", "S5", "S6", "S7", "S8", "S9", "S10"].join("\n") + "\n");
    expect(b).toBe(["X1", "S2", "S3", "S4", "X2"].join("\n") + "\n");
  });

  it("operation marked executed with post-hashes populated", () => {
    const p = preview();
    executeOperation({ operation_id: p.operation_id }, ws.config);
    const op = loadOperation(p.operation_id, ws.config);
    expect(op.status).toBe("executed");
    expect(op.source_file_hash_after).toMatch(/^[0-9a-f]{64}$/);
    expect(op.dest_file_hash_after).toMatch(/^[0-9a-f]{64}$/);
    const a = ws.read("a.txt");
    expect(op.source_file_hash_after).toBe(sha256(a));
  });

  it("response leaks no content", () => {
    const p = preview();
    const r = executeOperation({ operation_id: p.operation_id }, ws.config);
    assertNoLeakedContent(r);
  });

  it("snapshot dir contains snapshots after execution", () => {
    const p = preview();
    executeOperation({ operation_id: p.operation_id }, ws.config);
    expect(
      existsSync(join(ws.root, ".mcp-line-mover", "snapshots", p.operation_id, "manifest.json")),
    ).toBe(true);
  });

  it("preserves CRLF line endings in dest", () => {
    ws.write("a.txt", "L1\nL2\nL3\n");
    ws.write("c.txt", "C1\r\nC2\r\n");
    const out = previewMoveLines(
      {
        source_path: "a.txt",
        start_line: 1,
        end_line: 2,
        dest_path: "c.txt",
        dest_line: 1,
        placement: "after",
        remove_from_source: true,
      },
      ws.config,
    );
    if (!out.ok) throw new Error("preview failed");
    executeOperation({ operation_id: out.operation_id }, ws.config);
    const c = ws.read("c.txt").toString();
    expect(c).toBe("C1\r\nL1\r\nL2\r\nC2\r\n");
  });

  it("preserves no-trailing-newline of dest", () => {
    ws.write("a.txt", "x\ny\n");
    ws.write("d.txt", "D1\nD2");
    const out = previewMoveLines(
      {
        source_path: "a.txt",
        start_line: 1,
        end_line: 1,
        dest_path: "d.txt",
        dest_line: 2,
        placement: "after",
        remove_from_source: true,
      },
      ws.config,
    );
    if (!out.ok) throw new Error("preview failed");
    executeOperation({ operation_id: out.operation_id }, ws.config);
    const d = ws.read("d.txt").toString();
    expect(d).toBe("D1\nD2\nx");
  });

  it("creates dest file when create_dest_if_missing=true", () => {
    ws.write("a.txt", "alpha\nbeta\n");
    const out = preview({
      dest_path: "newdir/new.txt",
      dest_line: 1,
      placement: "before",
      create_dest_if_missing: true,
      create_parent_dirs: true,
      start_line: 1,
      end_line: 1,
    });
    executeOperation({ operation_id: out.operation_id }, ws.config);
    expect(ws.read("newdir/new.txt").toString()).toBe("alpha\n");
  });

  it("placement=before with dest_line=length+1 appends to dest", () => {
    ws.write("a.txt", "MOV\nrest\n");
    ws.write("b.txt", "B1\nB2\n");
    const out = previewMoveLines(
      {
        source_path: "a.txt",
        start_line: 1,
        end_line: 1,
        dest_path: "b.txt",
        dest_line: 3,
        placement: "before",
        remove_from_source: true,
      },
      ws.config,
    );
    if (!out.ok) throw new Error("preview failed");
    executeOperation({ operation_id: out.operation_id }, ws.config);
    expect(ws.read("b.txt").toString()).toBe("B1\nB2\nMOV\n");
  });
});

describe("executeOperation refusals", () => {
  beforeEach(() => {
    ws.write("a.txt", tenLines);
    ws.write("b.txt", "X1\nX2\n");
  });

  it("refuses when source changed since preview", () => {
    const p = preview();
    writeFileSync(join(ws.root, "a.txt"), tenLines + "EXTRA\n");
    const r = executeOperation({ operation_id: p.operation_id }, ws.config);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error_code).toBe("FILE_CHANGED_SINCE_PREVIEW");
  });

  it("refuses when dest changed since preview", () => {
    const p = preview();
    writeFileSync(join(ws.root, "b.txt"), "MUTATED\n");
    const r = executeOperation({ operation_id: p.operation_id }, ws.config);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error_code).toBe("FILE_CHANGED_SINCE_PREVIEW");
  });

  it("refuses re-executing already-executed operation", () => {
    const p = preview();
    executeOperation({ operation_id: p.operation_id }, ws.config);
    const r = executeOperation({ operation_id: p.operation_id }, ws.config);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error_code).toBe("OPERATION_ALREADY_EXECUTED");
  });

  it("returns OPERATION_NOT_FOUND for unknown op", () => {
    const r = executeOperation({ operation_id: "NONESUCH" }, ws.config);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error_code).toBe("OPERATION_NOT_FOUND");
  });

  it("returns OPERATION_NOT_FOUND for expired op", () => {
    const cfg = ws.withEnv({ LINE_MOVER_OPERATION_TTL_DAYS: "1" });
    const p = preview();
    const file = join(ws.root, ".mcp-line-mover", "operations", `${p.operation_id}.json`);
    const stored = JSON.parse(readFileSync(file, "utf8"));
    stored.created_at = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    writeFileSync(file, JSON.stringify(stored));
    const r = executeOperation({ operation_id: p.operation_id }, cfg);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error_code).toBe("OPERATION_NOT_FOUND");
  });

  it("metadata-only changes (mtime touch) do not trigger refusal", () => {
    const p = preview();
    const before = readFileSync(join(ws.root, "a.txt"));
    writeFileSync(join(ws.root, "a.txt"), before);
    const r = executeOperation({ operation_id: p.operation_id }, ws.config);
    expect(r.ok).toBe(true);
  });
});

describe("executeOperation rollback on write failure", () => {
  it("restores files from snapshot if dest write fails", async () => {
    ws.write("a.txt", tenLines);
    ws.write("b.txt", "X1\nX2\n");
    const p = preview();

    const filesMod = await import("../../src/core/files.js");
    let writeCount = 0;
    const realWrite = filesMod.writeAtomic;
    const spy = vi.spyOn(filesMod, "writeAtomic").mockImplementation((path, content, opts) => {
      writeCount++;
      if (writeCount === 2) {
        throw new Error("simulated write failure");
      }
      return realWrite(path, content, opts);
    });

    try {
      const r = executeOperation({ operation_id: p.operation_id }, ws.config);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error_code).toBe("WRITE_FAILED");
    } finally {
      spy.mockRestore();
    }

    // Verify files were rolled back to original state
    expect(ws.read("a.txt").toString()).toBe(tenLines);
    expect(ws.read("b.txt").toString()).toBe("X1\nX2\n");
  });
});
