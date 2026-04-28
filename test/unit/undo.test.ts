import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { previewMoveLines } from "../../src/tools/previewMoveLines.js";
import { executeOperation } from "../../src/tools/executeOperation.js";
import { moveLines } from "../../src/tools/moveLines.js";
import { undoOperation } from "../../src/tools/undoOperation.js";
import { loadOperation } from "../../src/core/operations.js";
import { assertNoLeakedContent } from "../helpers/assertNoLeakedContent.js";
import { makeTmpWorkspace, type TmpWorkspace } from "../helpers/tmpWorkspace.js";

let ws: TmpWorkspace;
beforeEach(() => {
  ws = makeTmpWorkspace();
});
afterEach(() => ws.cleanup());

const ORIG_A = "S1\nS2\nS3\nS4\nS5\n";
const ORIG_B = "X1\nX2\n";

function executedOp(): string {
  ws.write("a.txt", ORIG_A);
  ws.write("b.txt", ORIG_B);
  const r = moveLines(
    {
      source_path: "a.txt",
      start_line: 2,
      end_line: 3,
      dest_path: "b.txt",
      dest_line: 1,
      placement: "after",
      remove_from_source: true,
    },
    ws.config,
  );
  if (!r.ok) throw new Error("move failed");
  return r.operation_id;
}

describe("undoOperation happy path", () => {
  it("restores byte-identical content with explicit op id", () => {
    const opId = executedOp();
    const r = undoOperation({ operation_id: opId }, ws.config);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.restored_files.length).toBe(2);
    expect(ws.read("a.txt").toString()).toBe(ORIG_A);
    expect(ws.read("b.txt").toString()).toBe(ORIG_B);
  });

  it("status becomes undone", () => {
    const opId = executedOp();
    undoOperation({ operation_id: opId }, ws.config);
    const op = loadOperation(opId, ws.config);
    expect(op.status).toBe("undone");
  });

  it("undoes most recent executed op when id omitted", async () => {
    const a = executedOp();
    await new Promise((r) => setTimeout(r, 5));
    ws.write("c.txt", "C1\nC2\nC3\n");
    ws.write("d.txt", "D1\n");
    const r2 = moveLines(
      {
        source_path: "c.txt",
        start_line: 1,
        end_line: 1,
        dest_path: "d.txt",
        dest_line: 1,
        placement: "after",
        remove_from_source: true,
      },
      ws.config,
    );
    if (!r2.ok) throw new Error("second move failed");
    const second = r2.operation_id;
    const r = undoOperation({}, ws.config);
    expect(r.ok).toBe(true);
    expect(loadOperation(second, ws.config).status).toBe("undone");
    expect(loadOperation(a, ws.config).status).toBe("executed");
  });

  it("response leaks no content", () => {
    const opId = executedOp();
    const r = undoOperation({ operation_id: opId }, ws.config);
    assertNoLeakedContent(r);
  });
});

describe("undoOperation refusals", () => {
  it("operation in previewed state -> OPERATION_NOT_UNDOABLE", () => {
    ws.write("a.txt", ORIG_A);
    ws.write("b.txt", ORIG_B);
    const p = previewMoveLines(
      {
        source_path: "a.txt",
        start_line: 1,
        end_line: 1,
        dest_path: "b.txt",
        dest_line: 1,
        placement: "after",
        remove_from_source: true,
      },
      ws.config,
    );
    if (!p.ok) throw new Error("preview failed");
    const r = undoOperation({ operation_id: p.operation_id }, ws.config);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error_code).toBe("OPERATION_NOT_UNDOABLE");
  });

  it("already-undone op -> OPERATION_NOT_UNDOABLE", () => {
    const opId = executedOp();
    undoOperation({ operation_id: opId }, ws.config);
    const r = undoOperation({ operation_id: opId }, ws.config);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error_code).toBe("OPERATION_NOT_UNDOABLE");
  });

  it("file modified after execution -> FILE_CHANGED_SINCE_EXECUTION", () => {
    const opId = executedOp();
    writeFileSync(join(ws.root, "b.txt"), "TAMPERED\n");
    const r = undoOperation({ operation_id: opId }, ws.config);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error_code).toBe("FILE_CHANGED_SINCE_EXECUTION");
    expect(ws.read("b.txt").toString()).toBe("TAMPERED\n");
  });

  it("missing snapshot -> OPERATION_NOT_UNDOABLE", () => {
    const opId = executedOp();
    rmSync(join(ws.root, ".mcp-line-mover", "snapshots", opId), { recursive: true });
    const r = undoOperation({ operation_id: opId }, ws.config);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error_code).toBe("OPERATION_NOT_UNDOABLE");
  });

  it("undo with no ops at all -> OPERATION_NOT_FOUND", () => {
    const r = undoOperation({}, ws.config);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error_code).toBe("OPERATION_NOT_FOUND");
  });

  it("explicit unknown op id -> OPERATION_NOT_FOUND", () => {
    const r = undoOperation({ operation_id: "NOSUCH" }, ws.config);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error_code).toBe("OPERATION_NOT_FOUND");
  });
});

describe("preview-then-execute integration", () => {
  it("safe workflow round-trip then undo", () => {
    ws.write("a.txt", ORIG_A);
    ws.write("b.txt", ORIG_B);
    const p = previewMoveLines(
      {
        source_path: "a.txt",
        start_line: 2,
        end_line: 4,
        dest_path: "b.txt",
        dest_line: 2,
        placement: "after",
        remove_from_source: true,
      },
      ws.config,
    );
    if (!p.ok) throw new Error("preview failed");
    const e = executeOperation({ operation_id: p.operation_id }, ws.config);
    expect(e.ok).toBe(true);
    expect(ws.read("a.txt").toString()).toBe("S1\nS5\n");
    expect(ws.read("b.txt").toString()).toBe("X1\nX2\nS2\nS3\nS4\n");

    const u = undoOperation({ operation_id: p.operation_id }, ws.config);
    expect(u.ok).toBe(true);
    expect(ws.read("a.txt").toString()).toBe(ORIG_A);
    expect(ws.read("b.txt").toString()).toBe(ORIG_B);
  });
});
