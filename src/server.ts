import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig, type Config } from "./core/config.js";
import { audit } from "./core/audit.js";
import { previewMoveLines } from "./tools/previewMoveLines.js";
import { executeOperation } from "./tools/executeOperation.js";
import { moveLines } from "./tools/moveLines.js";
import { undoOperation } from "./tools/undoOperation.js";
import {
  moveInputShape,
  executeInputShape,
  undoInputShape,
} from "./schemas.js";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { name: string; version: string };

export function buildServer(config: Config): McpServer {
  const server = new McpServer(
    { name: pkg.name, version: pkg.version },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "preview_move_lines",
    {
      title: "Preview a line-range move",
      description:
        "Validate and record a proposed move without mutating files. Returns an operation_id usable with execute_operation.",
      inputSchema: moveInputShape,
    },
    async (args) => wrap("preview_move_lines", () => previewMoveLines(args, config)),
  );

  server.registerTool(
    "execute_operation",
    {
      title: "Execute a previewed move",
      description:
        "Apply a previously previewed move using its operation_id. Refuses if files changed since preview.",
      inputSchema: executeInputShape,
    },
    async (args) => wrap("execute_operation", () => executeOperation(args, config), args.operation_id),
  );

  server.registerTool(
    "move_lines",
    {
      title: "One-shot move",
      description:
        "Validate and apply a move in a single call. Convenience shortcut; use preview_move_lines + execute_operation for safer workflow.",
      inputSchema: moveInputShape,
    },
    async (args) => wrap("move_lines", () => moveLines(args, config)),
  );

  server.registerTool(
    "undo_operation",
    {
      title: "Undo an executed move",
      description:
        "Restore exact pre-operation file contents from snapshots. Refuses if files changed after execution.",
      inputSchema: undoInputShape,
    },
    async (args) => wrap("undo_operation", () => undoOperation(args, config), args.operation_id),
  );

  return server;
}

function wrap(
  toolName: string,
  fn: () => unknown,
  inputOpId?: string,
): CallToolResult {
  try {
    const result = fn() as { ok?: boolean; operation_id?: string; error_code?: string };
    const isError = result.ok === false;
    audit({
      tool: toolName,
      operation_id: result.operation_id ?? inputOpId,
      status: isError ? "error" : "ok",
      ...(isError && result.error_code ? { error_code: result.error_code } : {}),
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result as { [k: string]: unknown },
      ...(isError ? { isError: true } : {}),
    };
  } catch (err) {
    audit({
      tool: toolName,
      ...(inputOpId !== undefined ? { operation_id: inputOpId } : {}),
      status: "error",
      error_code: "INTERNAL_ERROR",
    });
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ ok: false, error_code: "INTERNAL_ERROR", message }),
        },
      ],
      isError: true,
    };
  }
}

export async function runServer(transport?: Transport): Promise<McpServer> {
  const config = loadConfig(process.env, process.cwd());
  const server = buildServer(config);
  await server.connect(transport ?? new StdioServerTransport());
  return server;
}
