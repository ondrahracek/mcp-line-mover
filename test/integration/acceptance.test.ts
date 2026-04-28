import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildServer } from "../../src/server.js";
import { assertNoLeakedContent } from "../helpers/assertNoLeakedContent.js";
import { makeTmpWorkspace, type TmpWorkspace } from "../helpers/tmpWorkspace.js";

let ws: TmpWorkspace;
let client: Client;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ws = makeTmpWorkspace();
  const server = buildServer(ws.config);
  client = new Client({ name: "acceptance", version: "0.0.0" }, { capabilities: {} });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  cleanup = async () => {
    await client.close();
    await server.close();
  };
});

afterEach(async () => {
  await cleanup();
  ws.cleanup();
});

async function call(name: string, args: unknown): Promise<{ raw: unknown; parsed: Record<string, unknown> }> {
  const res = await client.callTool({ name, arguments: args as Record<string, unknown> });
  const text = ((res.content as Array<{ text: string }>)[0]).text;
  return { raw: res, parsed: JSON.parse(text) };
}

describe("Spec §21 MVP acceptance criteria", () => {
  it("server exposes the four required tools", async () => {
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "execute_operation",
      "move_lines",
      "preview_move_lines",
      "undo_operation",
    ]);
  });

  it("agent moves a 100+ line range without providing source text", async () => {
    const lines = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    ws.write("big.txt", lines);
    ws.write("dest.txt", "HEAD\n");

    const args = {
      source_path: "big.txt",
      start_line: 50,
      end_line: 200,
      dest_path: "dest.txt",
      dest_line: 1,
      placement: "after",
    };
    const argSize = JSON.stringify(args).length;
    expect(argSize).toBeLessThan(300);

    const out = await call("preview_move_lines", args);
    expect(out.parsed.ok).toBe(true);
    expect(out.parsed.moved_line_count).toBe(151);
  });

  it("agent executes a previewed op using only operation_id", async () => {
    ws.write("a.txt", "S1\nS2\nS3\n");
    ws.write("b.txt", "X\n");
    const p = await call("preview_move_lines", {
      source_path: "a.txt",
      start_line: 1,
      end_line: 1,
      dest_path: "b.txt",
      dest_line: 1,
      placement: "after",
    });
    const opId = p.parsed.operation_id as string;
    const e = await call("execute_operation", { operation_id: opId });
    expect(e.parsed.ok).toBe(true);
    const argSize = JSON.stringify({ operation_id: opId }).length;
    expect(argSize).toBeLessThan(60);
  });

  it("server refuses execution if source changed since preview", async () => {
    ws.write("a.txt", "S1\nS2\n");
    ws.write("b.txt", "X\n");
    const p = await call("preview_move_lines", {
      source_path: "a.txt",
      start_line: 1,
      end_line: 1,
      dest_path: "b.txt",
      dest_line: 1,
      placement: "after",
    });
    writeFileSync(join(ws.root, "a.txt"), "TAMPERED\n");
    const e = await call("execute_operation", { operation_id: p.parsed.operation_id as string });
    expect(e.parsed.ok).toBe(false);
    expect(e.parsed.error_code).toBe("FILE_CHANGED_SINCE_PREVIEW");
  });

  it("server refuses execution if destination changed since preview", async () => {
    ws.write("a.txt", "S1\n");
    ws.write("b.txt", "B1\n");
    const p = await call("preview_move_lines", {
      source_path: "a.txt",
      start_line: 1,
      end_line: 1,
      dest_path: "b.txt",
      dest_line: 1,
      placement: "after",
    });
    writeFileSync(join(ws.root, "b.txt"), "TAMPERED\n");
    const e = await call("execute_operation", { operation_id: p.parsed.operation_id as string });
    expect(e.parsed.error_code).toBe("FILE_CHANGED_SINCE_PREVIEW");
  });

  it("server creates snapshots before mutation", async () => {
    ws.write("a.txt", "S1\nS2\n");
    ws.write("b.txt", "X\n");
    const m = await call("move_lines", {
      source_path: "a.txt",
      start_line: 1,
      end_line: 1,
      dest_path: "b.txt",
      dest_line: 1,
      placement: "after",
    });
    const opId = m.parsed.operation_id as string;
    expect(
      existsSync(join(ws.root, ".mcp-line-mover", "snapshots", opId, "manifest.json")),
    ).toBe(true);
  });

  it("server can undo a successful operation by restoring snapshots", async () => {
    const ORIG_A = "S1\nS2\nS3\n";
    const ORIG_B = "X1\nX2\n";
    ws.write("a.txt", ORIG_A);
    ws.write("b.txt", ORIG_B);
    const m = await call("move_lines", {
      source_path: "a.txt",
      start_line: 1,
      end_line: 2,
      dest_path: "b.txt",
      dest_line: 1,
      placement: "after",
    });
    const u = await call("undo_operation", { operation_id: m.parsed.operation_id as string });
    expect(u.parsed.ok).toBe(true);
    expect(ws.read("a.txt").toString()).toBe(ORIG_A);
    expect(ws.read("b.txt").toString()).toBe(ORIG_B);
  });

  it("server rejects paths outside the workspace", async () => {
    ws.write("a.txt", "x\n");
    const e = await call("preview_move_lines", {
      source_path: "../../../etc/passwd",
      start_line: 1,
      end_line: 1,
      dest_path: "a.txt",
      dest_line: 1,
      placement: "after",
    });
    expect(e.parsed.error_code).toBe("PATH_OUTSIDE_WORKSPACE");
  });

  it("server rejects .git and node_modules", async () => {
    mkdirSync(join(ws.root, ".git"), { recursive: true });
    writeFileSync(join(ws.root, ".git", "config"), "x\n");
    ws.write("a.txt", "y\n");
    const e1 = await call("preview_move_lines", {
      source_path: ".git/config",
      start_line: 1,
      end_line: 1,
      dest_path: "a.txt",
      dest_line: 1,
      placement: "after",
    });
    expect(e1.parsed.error_code).toBe("PATH_DENIED");

    mkdirSync(join(ws.root, "node_modules", "foo"), { recursive: true });
    writeFileSync(join(ws.root, "node_modules", "foo", "x.js"), "z\n");
    const e2 = await call("preview_move_lines", {
      source_path: "node_modules/foo/x.js",
      start_line: 1,
      end_line: 1,
      dest_path: "a.txt",
      dest_line: 1,
      placement: "after",
    });
    expect(e2.parsed.error_code).toBe("PATH_DENIED");
  });

  it("server preserves moved text exactly (byte-for-byte)", async () => {
    const exotic = "  leading spaces\n\ttabs and \"quotes\"\núnîcôdé\n\nblank above\n";
    ws.write("a.txt", exotic);
    ws.write("b.txt", "X\n");
    const m = await call("move_lines", {
      source_path: "a.txt",
      start_line: 1,
      end_line: 5,
      dest_path: "b.txt",
      dest_line: 1,
      placement: "after",
    });
    expect(m.parsed.ok).toBe(true);
    expect(ws.read("b.txt").toString()).toBe("X\n" + exotic);
  });

  it("server returns concise metadata and never the moved content", async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `body line ${i + 1}`).join("\n") + "\n";
    ws.write("a.txt", lines);
    ws.write("b.txt", "Z\n");
    const p = await call("preview_move_lines", {
      source_path: "a.txt",
      start_line: 1,
      end_line: 100,
      dest_path: "b.txt",
      dest_line: 1,
      placement: "after",
    });
    assertNoLeakedContent(p.parsed);
    const previewSize = JSON.stringify(p.parsed).length;
    const sourceSize = lines.length;
    expect(previewSize).toBeLessThan(sourceSize);
    expect(JSON.stringify(p.parsed)).not.toContain("body line 50");

    const e = await call("execute_operation", { operation_id: p.parsed.operation_id as string });
    assertNoLeakedContent(e.parsed);
    expect(JSON.stringify(e.parsed)).not.toContain("body line 50");

    const u = await call("undo_operation", { operation_id: p.parsed.operation_id as string });
    assertNoLeakedContent(u.parsed);
  });
});
