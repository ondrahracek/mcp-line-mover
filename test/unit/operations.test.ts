import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  generateOperationId,
  createOperation,
  loadOperation,
  updateOperation,
  listOperations,
  type OperationRecord,
} from "../../src/core/operations.js";
import { AppError } from "../../src/core/errors.js";
import { makeTmpWorkspace, type TmpWorkspace } from "../helpers/tmpWorkspace.js";

let ws: TmpWorkspace;
beforeEach(() => {
  ws = makeTmpWorkspace();
});
afterEach(() => ws.cleanup());

function baseInput(): Omit<OperationRecord, "operation_id" | "created_at" | "updated_at" | "status" | "workspace_root"> {
  return {
    description: "test op",
    source_path: "src.txt",
    start_line: 1,
    end_line: 3,
    dest_path: "dest.txt",
    dest_line: 1,
    placement: "after",
    remove_from_source: true,
    create_dest_if_missing: false,
    create_parent_dirs: false,
    moved_line_count: 3,
    source_file_hash_before: "h1",
    dest_file_hash_before: "h2",
    selected_range_hash_before: "h3",
    warnings: [],
  };
}

describe("generateOperationId", () => {
  it("returns short opaque ids", () => {
    const id = generateOperationId();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
    expect(id.length).toBeLessThanOrEqual(16);
    expect(id.length).toBeGreaterThanOrEqual(8);
  });
  it("produces unique ids over 100k generations", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100_000; i++) seen.add(generateOperationId());
    expect(seen.size).toBe(100_000);
  });
});

describe("createOperation + loadOperation", () => {
  it("persists record under .mcp-line-mover/operations/<id>.json", () => {
    const op = createOperation(baseInput(), ws.root, ws.config);
    const file = join(ws.root, ".mcp-line-mover", "operations", `${op.operation_id}.json`);
    expect(existsSync(file)).toBe(true);
    const stored = JSON.parse(readFileSync(file, "utf8"));
    expect(stored.operation_id).toBe(op.operation_id);
    expect(stored.status).toBe("previewed");
    expect(stored.source_path).toBe("src.txt");
    expect(stored.created_at).toBeTypeOf("string");
    expect(stored.updated_at).toBeTypeOf("string");
  });

  it("loadOperation round-trips all fields", () => {
    const op = createOperation(baseInput(), ws.root, ws.config);
    const loaded = loadOperation(op.operation_id, ws.root, ws.config);
    expect(loaded).toEqual(op);
  });

  it("loadOperation throws OPERATION_NOT_FOUND for missing id", () => {
    try {
      loadOperation("NOSUCH", ws.root, ws.config);
      expect.fail("should throw");
    } catch (e) {
      expect((e as AppError).code).toBe("OPERATION_NOT_FOUND");
    }
  });

  it("survives across config instances (process restart simulation)", () => {
    const op = createOperation(baseInput(), ws.root, ws.config);
    const cfg2 = ws.withEnv({});
    const loaded = loadOperation(op.operation_id, ws.root, cfg2);
    expect(loaded.operation_id).toBe(op.operation_id);
  });
});

describe("updateOperation", () => {
  it("updates status and merges fields, advances updated_at", async () => {
    const op = createOperation(baseInput(), ws.root, ws.config);
    await new Promise((r) => setTimeout(r, 10));
    const updated = updateOperation(
      op.operation_id,
      op.updated_at,
      { status: "executed", source_file_hash_after: "post1", dest_file_hash_after: "post2" },
      ws.root,
      ws.config,
    );
    expect(updated.status).toBe("executed");
    expect(updated.source_file_hash_after).toBe("post1");
    expect(updated.dest_file_hash_after).toBe("post2");
    expect(updated.updated_at).not.toBe(op.updated_at);
  });

  it("rejects optimistic check failure (concurrent update)", () => {
    const op = createOperation(baseInput(), ws.root, ws.config);
    updateOperation(op.operation_id, op.updated_at, { status: "executed" }, ws.root, ws.config);
    try {
      updateOperation(
        op.operation_id,
        op.updated_at,
        { status: "undone" },
        ws.root,
        ws.config,
      );
      expect.fail("should throw");
    } catch (e) {
      expect((e as AppError).code).toBe("OPERATION_NOT_FOUND");
    }
  });

  it("rejects backward transitions", () => {
    const op = createOperation(baseInput(), ws.root, ws.config);
    const e1 = updateOperation(op.operation_id, op.updated_at, { status: "executed" }, ws.root, ws.config);
    const u1 = updateOperation(op.operation_id, e1.updated_at, { status: "undone" }, ws.root, ws.config);
    expect(() =>
      updateOperation(op.operation_id, u1.updated_at, { status: "executed" }, ws.root, ws.config),
    ).toThrow(AppError);
  });
});

describe("TTL / expiry", () => {
  it("loadOperation returns expired status when older than TTL", () => {
    const cfg = ws.withEnv({ LINE_MOVER_OPERATION_TTL_DAYS: "1" });
    const op = createOperation(baseInput(), ws.root, cfg);
    const file = join(ws.root, ".mcp-line-mover", "operations", `${op.operation_id}.json`);
    const stored = JSON.parse(readFileSync(file, "utf8"));
    stored.created_at = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    writeFileSync(file, JSON.stringify(stored));
    const loaded = loadOperation(op.operation_id, ws.root, cfg);
    expect(loaded.status).toBe("expired");
  });

  it("does not delete the file on expiry", () => {
    const cfg = ws.withEnv({ LINE_MOVER_OPERATION_TTL_DAYS: "1" });
    const op = createOperation(baseInput(), ws.root, cfg);
    const file = join(ws.root, ".mcp-line-mover", "operations", `${op.operation_id}.json`);
    const stored = JSON.parse(readFileSync(file, "utf8"));
    stored.created_at = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    writeFileSync(file, JSON.stringify(stored));
    loadOperation(op.operation_id, ws.root, cfg);
    expect(existsSync(file)).toBe(true);
  });
});

describe("listOperations", () => {
  it("returns all operations sorted by updated_at desc", async () => {
    const a = createOperation(baseInput(), ws.root, ws.config);
    await new Promise((r) => setTimeout(r, 5));
    const b = createOperation(baseInput(), ws.root, ws.config);
    const list = listOperations(ws.root, ws.config);
    expect(list.length).toBe(2);
    expect(list[0]?.operation_id).toBe(b.operation_id);
    expect(list[1]?.operation_id).toBe(a.operation_id);
  });

  it("ignores non-json files in the operations dir", () => {
    createOperation(baseInput(), ws.root, ws.config);
    const dir = join(ws.root, ".mcp-line-mover", "operations");
    writeFileSync(join(dir, "stray.txt"), "ignore");
    const list = listOperations(ws.root, ws.config);
    expect(list.length).toBe(1);
    expect(readdirSync(dir).length).toBe(2);
  });

  it("returns empty array when dir does not exist", () => {
    expect(listOperations(ws.root, ws.config)).toEqual([]);
  });
});
