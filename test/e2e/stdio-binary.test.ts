import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync, realpathSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = resolve(__dirname, "..", "..");
const binPath = join(projectDir, "dist", "index.js");

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = realpathSync(mkdtempSync(join(tmpdir(), "lm-e2e-")));
});
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("stdio binary smoke test", () => {
  it("starts as stdio MCP server, lists 4 tools, executes preview->execute round-trip", async () => {
    writeFileSync(join(tmpRoot, "a.txt"), "S1\nS2\nS3\n");
    writeFileSync(join(tmpRoot, "b.txt"), "X1\n");

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [binPath],
      env: {
        ...process.env,
        LINE_MOVER_ROOT: tmpRoot,
        LINE_MOVER_AUDIT_SILENT: "1",
      },
    });
    const client = new Client({ name: "e2e", version: "0.0.0" }, { capabilities: {} });
    await client.connect(transport);
    try {
      const list = await client.listTools();
      const names = list.tools.map((t) => t.name).sort();
      expect(names).toEqual([
        "execute_operation",
        "move_lines",
        "preview_move_lines",
        "undo_operation",
      ]);

      const previewRes = await client.callTool({
        name: "preview_move_lines",
        arguments: {
          source_path: "a.txt",
          start_line: 1,
          end_line: 2,
          dest_path: "b.txt",
          dest_line: 1,
          placement: "after",
        },
      });
      const previewParsed = JSON.parse(((previewRes.content as Array<{ text: string }>)[0]).text);
      expect(previewParsed.ok).toBe(true);

      const execRes = await client.callTool({
        name: "execute_operation",
        arguments: { operation_id: previewParsed.operation_id },
      });
      const execParsed = JSON.parse(((execRes.content as Array<{ text: string }>)[0]).text);
      expect(execParsed.ok).toBe(true);
    } finally {
      await client.close();
    }
  });
});
