# mcp-line-mover

MCP stdio server that lets coding agents move contiguous line ranges between files **without copying the text through their own context window**. The agent supplies only `(source_path, start_line, end_line, dest_path, dest_line, placement)`; the server reads, hashes, snapshots, and rewrites files internally.

See [SPEC.md](SPEC.md) for the authoritative spec and [CLAUDE.md](CLAUDE.md) for engineering conventions.

## Install

In your MCP client config (e.g. `~/.claude.json` for Claude Code):

```json
{
  "mcpServers": {
    "line-mover": {
      "command": "npx",
      "args": ["-y", "mcp-line-mover"]
    }
  }
}
```

That's it. **No `env` block needed for typical use** — the server detects each repo automatically by walking up to the nearest `.git` directory. Works the same in every repo on your machine.

For locked-down or CI use, set `LINE_MOVER_ROOT` to pin a single workspace.

## Tools

- `preview_move_lines` — validate and record a proposed move; returns `operation_id` (non-mutating).
- `execute_operation` — apply a previewed move by id; refuses if files changed since preview.
- `move_lines` — one-shot preview+execute.
- `undo_operation` — restore from snapshot; refuses if files changed after execution.

## How workspace roots work

By default the server runs in **inferred mode**:

- Each tool call walks up from the path arguments to find the nearest workspace marker (default `.git`, configurable via `LINE_MOVER_ROOT_MARKERS`).
- Source and dest must resolve to the same workspace; cross-repo moves are rejected.
- Operations and snapshots live under each repo's own `.mcp-line-mover/` directory — add it to `.gitignore`.
- A small index at `~/.mcp-line-mover/roots.log` tracks which repos have outstanding operations so `execute_operation` and `undo_operation` work even after Claude Code restarts.

If `LINE_MOVER_ROOT` **is** set, inferred mode is disabled and the server operates as a single-root server (matching the original spec behavior).

## Configuration

```
LINE_MOVER_ROOT                 # default: unset (inferred mode); set to pin
LINE_MOVER_MAX_LINES            # default: 2000
LINE_MOVER_MAX_FILE_SIZE_MB     # default: 5
LINE_MOVER_ALLOW_CREATE         # default: false
LINE_MOVER_CREATE_PARENT_DIRS   # default: false
LINE_MOVER_DENY_GLOBS           # additive to defaults
LINE_MOVER_SNAPSHOT_DIR         # default: .mcp-line-mover
LINE_MOVER_OPERATION_TTL_DAYS   # default: 14
LINE_MOVER_ROOT_MARKERS         # default: .git (comma-separated; first match wins)
LINE_MOVER_MAX_ROOT_WALK        # default: 25 (hard cap 100)
LINE_MOVER_REGISTRY_DIR         # default: <home>/.mcp-line-mover
LINE_MOVER_AUDIT_SILENT         # set to "1" to silence stderr audit lines
```

## Develop

```
npm install
npm test         # unit + integration (266 tests)
npm run test:e2e # spawns the built binary via stdio
npm run build
npm run typecheck
```
