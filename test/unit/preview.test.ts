import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { previewMoveLines } from "../../src/tools/previewMoveLines.js";
import { listOperations } from "../../src/core/operations.js";
import { assertNoLeakedContent } from "../helpers/assertNoLeakedContent.js";
import { makeTmpWorkspace, type TmpWorkspace } from "../helpers/tmpWorkspace.js";

let ws: TmpWorkspace;
beforeEach(() => {
  ws = makeTmpWorkspace();
});
afterEach(() => ws.cleanup());

const tenLines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n") + "\n";

describe("previewMoveLines happy path", () => {
  beforeEach(() => {
    ws.write("a.txt", tenLines);
    ws.write("b.txt", "X\nY\nZ\n");
  });

  it("returns ok with operation_id and summary", () => {
    const out = previewMoveLines(
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
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.operation_id).toMatch(/^[0-9A-Z]+$/);
    expect(out.summary).toContain("a.txt");
    expect(out.summary).toContain("b.txt");
    expect(out.moved_line_count).toBe(3);
  });

  it("response never includes moved text", () => {
    const out = previewMoveLines(
      {
        source_path: "a.txt",
        start_line: 1,
        end_line: 5,
        dest_path: "b.txt",
        dest_line: 1,
        placement: "after",
        remove_from_source: true,
      },
      ws.config,
    );
    assertNoLeakedContent(out);
  });

  it("operation record persisted with all three pre-hashes populated", () => {
    const out = previewMoveLines(
      {
        source_path: "a.txt",
        start_line: 3,
        end_line: 5,
        dest_path: "b.txt",
        dest_line: 1,
        placement: "after",
        remove_from_source: true,
      },
      ws.config,
    );
    if (!out.ok) throw new Error("expected ok");
    const ops = listOperations(ws.root, ws.config);
    expect(ops.length).toBe(1);
    const op = ops[0]!;
    expect(op.operation_id).toBe(out.operation_id);
    expect(op.source_file_hash_before).toMatch(/^[0-9a-f]{64}$/);
    expect(op.dest_file_hash_before).toMatch(/^[0-9a-f]{64}$/);
    expect(op.selected_range_hash_before).toMatch(/^[0-9a-f]{64}$/);
  });

  it("two preview calls produce different operation ids", () => {
    const a = previewMoveLines(
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
    const b = previewMoveLines(
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
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.operation_id).not.toBe(b.operation_id);
  });

  it("does not modify source or dest", () => {
    previewMoveLines(
      {
        source_path: "a.txt",
        start_line: 1,
        end_line: 3,
        dest_path: "b.txt",
        dest_line: 2,
        placement: "after",
        remove_from_source: true,
      },
      ws.config,
    );
    expect(ws.read("a.txt").toString()).toBe(tenLines);
    expect(ws.read("b.txt").toString()).toBe("X\nY\nZ\n");
  });
});

describe("previewMoveLines error paths", () => {
  it("source missing -> SOURCE_NOT_FOUND", () => {
    ws.write("b.txt", "X\n");
    const out = previewMoveLines(
      {
        source_path: "missing.txt",
        start_line: 1,
        end_line: 1,
        dest_path: "b.txt",
        dest_line: 1,
        placement: "after",
        remove_from_source: true,
      },
      ws.config,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error_code).toBe("SOURCE_NOT_FOUND");
  });

  it("dest missing without create_dest_if_missing -> DEST_NOT_FOUND", () => {
    ws.write("a.txt", "x\n");
    const out = previewMoveLines(
      {
        source_path: "a.txt",
        start_line: 1,
        end_line: 1,
        dest_path: "new.txt",
        dest_line: 1,
        placement: "before",
        remove_from_source: true,
      },
      ws.config,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error_code).toBe("DEST_NOT_FOUND");
  });

  it("dest missing with create_dest_if_missing=true succeeds", () => {
    ws.write("a.txt", "alpha\nbeta\n");
    const out = previewMoveLines(
      {
        source_path: "a.txt",
        start_line: 1,
        end_line: 1,
        dest_path: "new.txt",
        dest_line: 1,
        placement: "before",
        remove_from_source: true,
        create_dest_if_missing: true,
      },
      ws.config,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.moved_line_count).toBe(1);
  });

  it("ALLOW_CREATE=true makes create_dest_if_missing default to true", () => {
    ws.write("a.txt", "x\n");
    const cfg = ws.withEnv({ LINE_MOVER_ALLOW_CREATE: "true" });
    const out = previewMoveLines(
      {
        source_path: "a.txt",
        start_line: 1,
        end_line: 1,
        dest_path: "new.txt",
        dest_line: 1,
        placement: "before",
        remove_from_source: true,
      },
      cfg,
    );
    expect(out.ok).toBe(true);
  });

  it("range > maxLines -> RANGE_TOO_LARGE", () => {
    const big = Array.from({ length: 100 }, (_, i) => `L${i}`).join("\n") + "\n";
    ws.write("a.txt", big);
    ws.write("b.txt", "x\n");
    const cfg = ws.withEnv({ LINE_MOVER_MAX_LINES: "10" });
    const out = previewMoveLines(
      {
        source_path: "a.txt",
        start_line: 1,
        end_line: 50,
        dest_path: "b.txt",
        dest_line: 1,
        placement: "after",
        remove_from_source: true,
      },
      cfg,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error_code).toBe("RANGE_TOO_LARGE");
  });

  it("file > maxFileSize -> FILE_TOO_LARGE", () => {
    const cfg = ws.withEnv({ LINE_MOVER_MAX_FILE_SIZE_MB: "1" });
    ws.write("a.txt", "x".repeat(2 * 1024 * 1024));
    ws.write("b.txt", "y\n");
    const out = previewMoveLines(
      {
        source_path: "a.txt",
        start_line: 1,
        end_line: 1,
        dest_path: "b.txt",
        dest_line: 1,
        placement: "after",
        remove_from_source: true,
      },
      cfg,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error_code).toBe("FILE_TOO_LARGE");
  });

  it("source==dest by string equality -> SAME_FILE_MOVE_UNSUPPORTED", () => {
    ws.write("a.txt", "x\ny\n");
    const out = previewMoveLines(
      {
        source_path: "a.txt",
        start_line: 1,
        end_line: 1,
        dest_path: "a.txt",
        dest_line: 2,
        placement: "after",
        remove_from_source: true,
      },
      ws.config,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error_code).toBe("SAME_FILE_MOVE_UNSUPPORTED");
  });

  it("denied path -> PATH_DENIED with no operation written", () => {
    ws.write("b.txt", "x\n");
    const out = previewMoveLines(
      {
        source_path: ".env",
        start_line: 1,
        end_line: 1,
        dest_path: "b.txt",
        dest_line: 1,
        placement: "after",
        remove_from_source: true,
      },
      ws.config,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error_code).toBe("PATH_DENIED");
    expect(existsSync(join(ws.root, ".mcp-line-mover", "operations"))).toBe(false);
  });

  it("invalid range -> INVALID_LINE_RANGE", () => {
    ws.write("a.txt", "x\ny\n");
    ws.write("b.txt", "z\n");
    const out = previewMoveLines(
      {
        source_path: "a.txt",
        start_line: 1,
        end_line: 99,
        dest_path: "b.txt",
        dest_line: 1,
        placement: "after",
        remove_from_source: true,
      },
      ws.config,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error_code).toBe("INVALID_LINE_RANGE");
  });

  it("invalid dest_line -> DEST_LINE_OUT_OF_RANGE", () => {
    ws.write("a.txt", "x\ny\n");
    ws.write("b.txt", "z\n");
    const out = previewMoveLines(
      {
        source_path: "a.txt",
        start_line: 1,
        end_line: 1,
        dest_path: "b.txt",
        dest_line: 99,
        placement: "after",
        remove_from_source: true,
      },
      ws.config,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error_code).toBe("DEST_LINE_OUT_OF_RANGE");
  });
});
