import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../../src/server.js";
import { makeTmpWorkspace, type TmpWorkspace } from "../helpers/tmpWorkspace.js";

let ws: TmpWorkspace;
let client: Client;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ws = makeTmpWorkspace();
  ws.write("a.txt", "L1\nL2\nL3\nL4\nL5\n");
  ws.write("b.txt", "X1\nX2\n");
  const server = buildServer(ws.config);
  client = new Client({ name: "test", version: "0.0.0" }, { capabilities: {} });
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

describe("MCP server registration", () => {
  it("registers exactly four tools with spec names", async () => {
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "execute_operation",
      "move_lines",
      "preview_move_lines",
      "undo_operation",
    ]);
  });

  it("exposes input schemas", async () => {
    const list = await client.listTools();
    const preview = list.tools.find((t) => t.name === "preview_move_lines");
    expect(preview?.inputSchema).toBeDefined();
    expect(preview?.inputSchema?.properties).toHaveProperty("source_path");
    expect(preview?.inputSchema?.properties).toHaveProperty("start_line");
  });
});

describe("MCP tool roundtrips", () => {
  it("preview -> execute via client", async () => {
    const previewRes = await client.callTool({
      name: "preview_move_lines",
      arguments: {
        source_path: "a.txt",
        start_line: 2,
        end_line: 3,
        dest_path: "b.txt",
        dest_line: 1,
        placement: "after",
      },
    });
    const previewParsed = JSON.parse(
      ((previewRes.content as Array<{ text: string }>)[0]).text,
    );
    expect(previewParsed.ok).toBe(true);
    const opId = previewParsed.operation_id;

    const execRes = await client.callTool({
      name: "execute_operation",
      arguments: { operation_id: opId },
    });
    const execParsed = JSON.parse(
      ((execRes.content as Array<{ text: string }>)[0]).text,
    );
    expect(execParsed.ok).toBe(true);
    expect(execParsed.files_changed.length).toBe(2);
    expect(ws.read("a.txt").toString()).toBe("L1\nL4\nL5\n");
    expect(ws.read("b.txt").toString()).toBe("X1\nL2\nL3\nX2\n");
  });

  it("error envelope on invalid call", async () => {
    const res = await client.callTool({
      name: "preview_move_lines",
      arguments: {
        source_path: "missing.txt",
        start_line: 1,
        end_line: 1,
        dest_path: "b.txt",
        dest_line: 1,
        placement: "after",
      },
    });
    const parsed = JSON.parse(((res.content as Array<{ text: string }>)[0]).text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error_code).toBe("SOURCE_NOT_FOUND");
    expect(res.isError).toBe(true);
  });

  it("undo via client", async () => {
    const moveRes = await client.callTool({
      name: "move_lines",
      arguments: {
        source_path: "a.txt",
        start_line: 1,
        end_line: 1,
        dest_path: "b.txt",
        dest_line: 1,
        placement: "after",
      },
    });
    const moveParsed = JSON.parse(((moveRes.content as Array<{ text: string }>)[0]).text);
    expect(moveParsed.ok).toBe(true);

    const undoRes = await client.callTool({
      name: "undo_operation",
      arguments: { operation_id: moveParsed.operation_id },
    });
    const undoParsed = JSON.parse(((undoRes.content as Array<{ text: string }>)[0]).text);
    expect(undoParsed.ok).toBe(true);
    expect(ws.read("a.txt").toString()).toBe("L1\nL2\nL3\nL4\nL5\n");
    expect(ws.read("b.txt").toString()).toBe("X1\nX2\n");
  });
});
