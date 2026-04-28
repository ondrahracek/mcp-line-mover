# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

`mcp-line-mover` is a stdio **Model Context Protocol** server that lets coding agents move contiguous line ranges between files **without copying the text through their own context window**. The agent supplies only `(source_path, start_line, end_line, dest_path, dest_line, placement)`; the server reads, hashes, snapshots, and rewrites files internally.

**[SPEC.md](SPEC.md) is the source of truth.** It uses RFC 2119 SHALL/SHOULD/MAY language and is detailed enough to drive implementation directly. When code and spec disagree, fix the code (or, if the spec is wrong, update the spec first and reference the change in the commit).

Distribution: an npm package launched via `npx -y mcp-line-mover` from an MCP client's `mcpServers` config. No setup step inside the target repo.

## Commands

> Filled in as the toolchain solidifies. Update this section when scripts change in `package.json`.

```
npm install            # install deps
npm run build          # tsc → dist/
npm run dev            # tsx watch on src/index.ts (stdio server)
npm test               # vitest run
npm test -- <pattern>  # single test file or name pattern
npm run lint           # eslint
npm run typecheck      # tsc --noEmit
```

Manual end-to-end testing uses the MCP Inspector against the built binary:

```
npx @modelcontextprotocol/inspector node dist/index.js
```

The package's `bin` entry must point to a shebanged `dist/index.js` so `npx -y mcp-line-mover` works after publish.

## Architecture

The system is organized around four MCP tools and an internal **operation record** that ties them together. Layout:

```
src/
  index.ts                   # bin entry — wires StdioServerTransport, exits on EPIPE
  server.ts                  # Server registration, tool dispatch, error envelope
  schemas.ts                 # zod input schemas for all four tools
  tools/
    previewMoveLines.ts
    executeOperation.ts
    moveLines.ts
    undoOperation.ts
    validateMove.ts          # shared pre-mutation validation
    applyMove.ts              # snapshot + write + rollback
  core/
    config.ts                # env parsing; produces frozen Config (incl. fixedRoot/null)
    workspace.ts             # marker walk + per-call Workspace resolution
    paths.ts                 # resolve + workspace-confine + denylist (root passed in)
    files.ts                 # read/write with LF/CRLF + final-newline preservation
    hash.ts                  # sha256 over bytes / over selected range
    lineMath.ts              # 1-based inclusive range math, splice/insert
    snapshots.ts             # write snapshot files, restore byte-for-byte
    operations.ts            # CRUD over operation records (JSON under each root's snapshotDir)
    operationLocator.ts      # cross-root op lookup via cwd + registry
    registry.ts              # ~/.mcp-line-mover/roots.log — index of seen workspace roots
    audit.ts                 # one-line stderr audit per tool call
    errors.ts                # AppError class keyed to spec §17 error codes
test/
  unit/                      # core helpers in isolation
  integration/               # tool-level + multi-root + acceptance
  e2e/                       # spawns the built binary via stdio
```

### Tool boundaries

- **`preview_move_lines`** (non-mutating). Validates → reads source+dest → hashes (`source_file_hash_before`, `dest_file_hash_before`, `selected_range_hash_before`) → persists operation record with status `previewed` → returns `operation_id` + summary. **Never returns moved text.**
- **`execute_operation`**. Loads operation → re-reads files → recomputes hashes → refuses if any of the three preview hashes changed → snapshots all files-to-be-modified → applies move → records `*_hash_after` → status `executed`.
- **`move_lines`**. One-shot fusion of preview+execute. Same input schema as preview.
- **`undo_operation`**. Loads `executed` operation → re-reads files → confirms current bytes match `*_hash_after` → restores from snapshot → status `undone`. **No force-undo in MVP.**

### Operation state machine

`previewed` → `executed` → `undone`

Branches: `previewed` → `expired` (TTL via `LINE_MOVER_OPERATION_TTL_DAYS`, default 14); any state → `failed`.

`undo_operation` requires status `executed` AND current hashes matching `*_hash_after`. If files changed post-execution, refuse with `FILE_CHANGED_SINCE_EXECUTION` — never best-effort restore.

### Operation persistence

Operation records and snapshots live under `${LINE_MOVER_SNAPSHOT_DIR}/` (default `.mcp-line-mover/`) inside the workspace root:

```
.mcp-line-mover/
  operations/<operation_id>.json   # full record per spec §9
  snapshots/<operation_id>/<safe_path>   # exact bytes for restore
```

Operation IDs are short, opaque, unique strings (e.g. base32 of crypto random + truncated time). Records must survive process restarts — `npx` may relaunch between preview and execute.

The snapshot directory must be created lazily and added to no global state. It must never be written outside `LINE_MOVER_ROOT`. Recommend documenting that users add `.mcp-line-mover/` to `.gitignore`.

## Cross-Cutting Invariants

These are easy to violate and break the security model. Treat as load-bearing:

- **Workspace identification.** Two modes:
  - *Fixed* — `LINE_MOVER_ROOT` set; `Config.fixedRoot` is the canonical root used for every call.
  - *Inferred* — unset; each tool call resolves its own root from input paths via `resolveWorkspaceForPaths`. Inferred roots must (a) contain a marker (default `.git`, file or directory), (b) be found within `LINE_MOVER_MAX_ROOT_WALK` levels, (c) **not equal `os.homedir()`** — refuse if it does.
  - Cross-call lookup (execute/undo) consults `process.cwd()` first, then the registry (`~/.mcp-line-mover/roots.log`). The registry holds *paths only*; it is an index, not a security boundary. A leaked or tampered registry can cause "id not found" errors but cannot cause incorrect mutations.
- **Workspace confinement.** Resolve all input paths via `path.resolve` against the resolved workspace root, then `fs.realpath` to canonicalize, then verify the canonical path starts with `realpath(root) + sep`. Reject parent-traversal, absolute paths outside root, and symlink escapes. Do this **once at the boundary**, not per-operation.
- **Denylist.** `.git/**`, `node_modules/**`, `.env`, `**/.env`, `**/*.pem`, `**/*.key` rejected by default. Configurable via `LINE_MOVER_DENY_GLOBS` (comma-separated globs, additive to defaults — do not let users disable the defaults silently).
- **Hashing.** SHA-256 over exact file bytes. The selected-range hash is over the exact bytes of lines `start_line..end_line` inclusive as the server interprets them, including their line terminators as found in the source.
- **Line-ending preservation.** Detect per file (look at the first terminator; default LF if file has none). Preserve when writing. Preserve final-newline convention (file ends in newline iff it did before).
- **Output discipline.** Tool responses MUST NOT include moved text by default. The whole point of the project is to keep that text out of the agent's context. Adding "just for debugging" output here is a regression — gate it behind an explicit debug flag if ever needed.
- **Atomic writes.** Write to `<path>.tmp-<rand>` in the same directory, fsync, rename. Avoid partial-write states that leave snapshots referring to bytes that no longer exist on disk.
- **Same-file moves.** MVP rejects with `SAME_FILE_MOVE_UNSUPPORTED`. Don't quietly support them — the line-shift math is a separate feature, not a freebie.
- **No shell, no Git, no AST.** The spec's non-goals (§2) are firm. Do not pull in `child_process`, `simple-git`, Babel/ts-morph, formatters, or linters as runtime deps. Refactor temptations belong in a different project.

## Implementation Choices Fixed by Spec

- **Runtime:** Node.js + TypeScript. Target a current LTS (Node 20+).
- **MCP library:** `@modelcontextprotocol/sdk` (official). Use its `Server` + `StdioServerTransport` + tool registration helpers — do not roll a JSON-RPC layer.
- **Schema validation:** zod (or equivalent) for tool input schemas; surface validation failures as structured errors with the right spec-defined error code, not as raw zod messages.
- **Transport:** stdio only for MVP. Streamable HTTP is explicitly out of scope.

## Configuration

All config via env vars (passed through MCP client config under `env`). Parse once at startup into a frozen object.

```
LINE_MOVER_ROOT                 # default: unset (inferred mode); set to pin to a fixed workspace
LINE_MOVER_MAX_LINES            # default: 2000
LINE_MOVER_MAX_FILE_SIZE_MB     # default: 5
LINE_MOVER_ALLOW_CREATE         # default: false   (governs create_dest_if_missing)
LINE_MOVER_CREATE_PARENT_DIRS   # default: false
LINE_MOVER_DENY_GLOBS           # comma-separated, additive to built-ins
LINE_MOVER_SNAPSHOT_DIR         # default: .mcp-line-mover
LINE_MOVER_OPERATION_TTL_DAYS   # default: 14
LINE_MOVER_ROOT_MARKERS         # default: .git (comma-separated; first match wins)
LINE_MOVER_MAX_ROOT_WALK        # default: 25 (hard cap 100)
LINE_MOVER_REGISTRY_DIR         # default: <home>/.mcp-line-mover
```

## Error Contract

Every tool returns either a success object or a structured error:

```ts
{ ok: false, error_code, message, details, recommended_action }
```

Error codes are enumerated in spec §17. When adding a new error path, prefer one of the existing codes; only invent a new code (and add it to the spec) when none fits. The `recommended_action` field is part of the contract — agents read it to decide whether to retry, re-preview, or give up.

## Testing Conventions

- **Unit tests** cover `core/` modules in isolation: line math edge cases (empty file, single-line range, range == whole file, dest at line 0, dest at last line), CRLF/LF round-trips, denylist matching, path resolution against tricky inputs (`..`, symlinks, absolute paths, paths with spaces).
- **Integration tests** spawn the server (or wire it up in-process via the SDK's test transport) and exercise full preview→execute→undo cycles against fixture files. Each integration test gets its own tmpdir as `LINE_MOVER_ROOT` — no shared state.
- **Hash-mismatch coverage is mandatory.** Tests must include: file modified between preview and execute (refuses), file modified between execute and undo (refuses), and the happy path through both transitions.
- Snapshots and operation records under `.mcp-line-mover/` are byproducts — never commit them, never assert on raw file paths inside; assert via the public tool API.

## Code Style

- Prefer narrow, pure functions in `core/`; tools should be thin glue.
- No comments unless the WHY is non-obvious. Spec section references (`// per SPEC §15`) are valid when behavior would otherwise look wrong.
- No defensive validation past the boundary — once `paths.ts` returns a confined absolute path, downstream code can trust it.
- All filesystem I/O goes through `core/files.ts` so line-ending and atomic-write rules live in one place.
