# Specification: Line Mover MCP Server

## 1. Purpose

The Line Mover MCP Server SHALL provide coding agents with safe, low-context file movement primitives for moving line ranges between files without requiring the agent to read, reproduce, paste, or delete large text blocks manually.

The system SHALL be installable as a local stdio MCP server through a single `npx` command in an MCP client configuration.

The primary target users are coding agents operating inside repositories where refactoring requires moving large method bodies, prompt blocks, configuration blocks, schemas, or other contiguous line ranges between files.

## 2. Non-Goals

The server SHALL NOT be a general-purpose shell execution tool.

The server SHALL NOT perform semantic refactoring, AST rewriting, import rewriting, formatting, linting, compilation, or test execution.

The server SHALL NOT require the agent to provide copied source text, hashes, diffs, or replacement blocks.

The server SHALL NOT require Git to be available.

The server SHALL NOT edit files outside the configured workspace root.

## 3. MCP Library and Runtime

The server SHALL be implemented in Node.js / TypeScript.

The server SHALL use the official Model Context Protocol TypeScript SDK package, `@modelcontextprotocol/sdk`, as the MCP implementation library. The official TypeScript SDK supports MCP server libraries for tools, resources, prompts, stdio, Streamable HTTP, and related helpers. ([GitHub][1])

The server SHALL expose a stdio transport as the default transport. MCP defines stdio and Streamable HTTP as standard transport mechanisms, and MCP clients are expected to support stdio where possible. ([Model Context Protocol][2])

The server MAY later support Streamable HTTP, but HTTP support SHALL NOT be required for the initial version.

## 4. Installation and Invocation

The package SHALL be distributable as an npm package with a binary entrypoint.

The intended client configuration SHALL follow this shape:

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

The server SHALL start, expose its MCP tools, and wait for MCP tool calls over stdio.

The agent SHALL NOT need to run any extra setup command inside the repository.

## 5. Core Concept

The server SHALL operate on line ranges using file paths and line numbers.

The canonical move operation is:

```json
{
  "source_path": "path/to/source.ts",
  "start_line": 100,
  "end_line": 200,
  "dest_path": "path/to/destination.ts",
  "dest_line": 50,
  "placement": "after"
}
```

The server SHALL read the relevant files internally.

The server SHALL compute file hashes internally.

The server SHALL store operation metadata internally.

The server SHALL return compact identifiers and summaries to the agent.

The server SHALL NOT return the full moved content unless explicitly requested by a future diagnostic/debug mode.

## 6. User Stories

### US-001: Move a Large Method Without Token Waste

As a developer, I want an agent to move a large method from one file to another without copying the entire method through its context, so that refactoring large files is cheaper, safer, and less error-prone.

Acceptance criteria:

```text
WHEN the agent knows the source file, start line, end line, destination file, and destination line
THEN the agent SHALL be able to move the line range using a compact MCP tool call
AND the agent SHALL NOT need to provide the moved text.
```

### US-002: Preview Before Mutation

As a developer, I want the agent to preview a move before applying it, so that risky line-number mistakes can be detected before files are changed.

Acceptance criteria:

```text
WHEN the agent calls preview_move_lines
THEN the server SHALL validate paths, line numbers, destination position, and operation feasibility
AND return a compact operation_id
AND return a human-readable summary
AND avoid modifying files.
```

### US-003: Execute a Previously Previewed Operation

As a developer, I want the agent to execute a previously previewed move using only an operation ID, so that it does not need to copy hashes, lines, or file contents.

Acceptance criteria:

```text
WHEN the agent calls execute_operation with a valid operation_id
THEN the server SHALL re-read the files
AND internally verify that relevant files still match the previewed state
AND apply the move only if validation succeeds.
```

### US-004: Undo a Bad Operation

As a developer, I want the agent to undo the last file movement operation if compilation, linting, or inspection shows it was wrong.

Acceptance criteria:

```text
WHEN the agent calls undo_operation
THEN the server SHALL restore the exact previous file contents from snapshots
AND SHALL NOT rely on line numbers to reverse the operation.
```

### US-005: Keep File Editing Inside the Repository

As a developer, I want the MCP server to be restricted to the current project directory, so that a mistaken or malicious tool call cannot edit unrelated files.

Acceptance criteria:

```text
WHEN a requested path resolves outside the configured workspace root
THEN the server SHALL reject the request.
```

### US-006: Preserve File Style

As a developer, I want the server to preserve line endings and trailing newline conventions, so that mechanical moves do not introduce avoidable formatting noise.

Acceptance criteria:

```text
WHEN the server edits files
THEN it SHALL preserve LF/CRLF style per file
AND SHOULD preserve final newline behavior.
```

### US-007: Avoid Dangerous Files

As a developer, I want sensitive or generated paths to be blocked by default, so that the agent cannot accidentally edit `.env`, `.git`, or dependency folders.

Acceptance criteria:

```text
WHEN a request targets denied files or directories
THEN the server SHALL reject the request before reading or writing.
```

## 7. Agent Stories

### AS-001: Move Lines Without Emitting Content

As a coding agent, I want to move lines by referencing file paths and line numbers, so that I do not need to emit large source blocks into tool calls.

Acceptance criteria:

```text
WHEN I call move_lines
THEN I SHALL provide only location metadata
AND the server SHALL perform the file content movement internally.
```

### AS-002: Use Operation IDs Instead of Hashes

As a coding agent, I want to preview an operation and then execute it using only an operation ID, so that I do not need to manage hashes manually.

Acceptance criteria:

```text
WHEN I call preview_move_lines
THEN I SHALL receive an operation_id
AND WHEN I call execute_operation with that operation_id
THEN the server SHALL internally validate whether the files changed since preview.
```

### AS-003: Recover From Mistakes

As a coding agent, I want to undo a move with a single operation ID, so that I can recover after a bad destination line, failed typecheck, or incorrect line range.

Acceptance criteria:

```text
WHEN I call undo_operation with operation_id
THEN the server SHALL restore the exact pre-operation file contents
AND report which files were restored.
```

### AS-004: Know What Changed

As a coding agent, I want the server to return concise metadata after a move, so that I know which files to inspect, format, compile, or test.

Acceptance criteria:

```text
WHEN a move succeeds
THEN the response SHALL include changed file paths, moved line count, operation_id, and undo availability.
```

### AS-005: Receive Refusal Instead of Silent Corruption

As a coding agent, I want the server to refuse stale or unsafe operations, so that I do not accidentally move the wrong lines.

Acceptance criteria:

```text
WHEN source or destination files changed after preview
THEN execute_operation SHALL refuse the operation
AND instruct me to re-run preview_move_lines.
```

## 8. MCP Tools

## 8.1 `preview_move_lines`

### Purpose

Validates and records a proposed move without mutating files.

### Mutating

No.

### Input Schema

```text
source_path: string, required
start_line: integer, required, 1-based inclusive
end_line: integer, required, 1-based inclusive
dest_path: string, required
dest_line: integer, required, 1-based
placement: enum("before", "after"), optional, default "after"
remove_from_source: boolean, optional, default true
create_dest_if_missing: boolean, optional, default false
create_parent_dirs: boolean, optional, default false
description: string, optional
```

### Validation Rules

```text
source_path SHALL resolve inside workspace root.
dest_path SHALL resolve inside workspace root.
source_path SHALL exist.
source_path SHALL be a regular text file.
dest_path SHALL exist unless create_dest_if_missing is true.
dest_path SHALL be a regular text file when it exists.
start_line SHALL be >= 1.
end_line SHALL be >= start_line.
end_line SHALL be <= source file line count.
dest_line SHALL be valid for destination file.
The selected range SHALL NOT exceed configured maximum moved line count.
The involved files SHALL NOT exceed configured maximum file size.
Denied path patterns SHALL be rejected.
```

### Behavior

The server SHALL:

```text
1. Resolve and validate paths.
2. Read source and destination files internally.
3. Compute internal hashes for source file, destination file, and selected source range.
4. Create an operation record with status "previewed".
5. Return a compact operation_id and summary.
6. Not modify any source or destination file.
```

### Output Schema

```text
ok: boolean
operation_id: string
summary: string
source_path: string
dest_path: string
start_line: integer
end_line: integer
dest_line: integer
placement: string
moved_line_count: integer
warnings: string[]
```

The output SHALL NOT include the full selected text by default.

---

## 8.2 `execute_operation`

### Purpose

Executes a previously previewed operation.

### Mutating

Yes.

### Input Schema

```text
operation_id: string, required
```

### Validation Rules

```text
operation_id SHALL refer to an existing previewed operation.
Operation status SHALL be "previewed".
Current source and destination file hashes SHALL match the hashes stored during preview.
The destination path SHALL still satisfy workspace and denylist rules.
The source path SHALL still satisfy workspace and denylist rules.
```

### Behavior

The server SHALL:

```text
1. Load the operation record.
2. Re-read current source and destination files.
3. Recompute internal file hashes.
4. Refuse execution if relevant files changed since preview.
5. Create pre-operation snapshots of all files that may be changed.
6. Apply the move.
7. Create post-operation snapshots or post-operation hashes.
8. Mark the operation status as "executed".
9. Return changed file metadata.
```

### Output Schema

```text
ok: boolean
operation_id: string
files_changed: string[]
moved_line_count: integer
undo_available: boolean
warnings: string[]
suggested_next_steps: string[]
```

Suggested next steps MAY include:

```text
Run formatter.
Run typecheck.
Inspect destination file around inserted block.
Search for duplicate moved block.
```

---

## 8.3 `move_lines`

### Purpose

Performs a direct one-shot move without requiring a separate preview call.

### Mutating

Yes.

### Input Schema

Same as `preview_move_lines`.

### Behavior

The server SHALL:

```text
1. Validate input.
2. Internally create an operation record.
3. Create snapshots.
4. Apply the move.
5. Mark operation as "executed".
6. Return operation_id and changed file metadata.
```

### Safety Position

This tool is a convenience shortcut.

The recommended agent workflow SHOULD be:

```text
preview_move_lines → execute_operation
```

The direct `move_lines` tool MAY be used for low-risk operations.

---

## 8.4 `undo_operation`

### Purpose

Restores exact pre-operation file contents from snapshots.

### Mutating

Yes.

### Input Schema

```text
operation_id: string, optional
```

If `operation_id` is omitted, the server MAY undo the most recent executed operation, provided this behavior is clearly documented.

### Validation Rules

```text
The target operation SHALL have status "executed".
The target operation SHALL have pre-operation snapshots.
Current files SHOULD match the stored post-operation hashes.
If current files do not match post-operation hashes, the server SHALL refuse undo by default.
```

### Behavior

The server SHALL:

```text
1. Load operation metadata.
2. Verify operation is undoable.
3. Verify current files have not changed since operation execution.
4. Restore exact pre-operation contents.
5. Mark operation status as "undone".
6. Return restored file metadata.
```

### Output Schema

```text
ok: boolean
operation_id: string
restored_files: string[]
warnings: string[]
```

---

## 8.5 Optional Future Tool: `list_operations`

### Purpose

Lists recent previewed, executed, failed, and undone operations.

### Mutating

No.

### Input Schema

```text
limit: integer, optional
status: enum("previewed", "executed", "failed", "undone"), optional
```

### Output Schema

```text
operations: array
```

Each operation item SHOULD include:

```text
operation_id
created_at
status
summary
files_involved
undo_available
```

---

## 8.6 Optional Future Tool: `find_anchor`

### Purpose

Finds line numbers by searching for a sentinel phrase, function name, class name, or anchor string.

### Mutating

No.

### Rationale

This can reduce stale line-number usage when the agent knows a symbol or phrase but not the exact line number.

This tool SHALL NOT be part of the MVP unless needed.

---

## 9. Operation Model

Each preview or mutation SHALL create an operation record.

### Operation Fields

```text
operation_id
created_at
updated_at
status
description
workspace_root
source_path
start_line
end_line
dest_path
dest_line
placement
remove_from_source
create_dest_if_missing
create_parent_dirs
moved_line_count
source_file_hash_before
dest_file_hash_before
selected_range_hash_before
source_file_hash_after
dest_file_hash_after
warnings
error
```

`workspace_root` SHALL be the absolute realpath of the workspace this operation
belongs to. It is set at preview/move time and never mutated. It is used by
`execute_operation` and `undo_operation` to locate the correct operation record
and snapshot directory across multi-root deployments (see §12).

### Operation Statuses

```text
previewed
executed
failed
undone
expired
```

### Operation ID

The operation ID SHALL be unique.

The operation ID SHALL be opaque to the agent.

The operation ID SHOULD be short enough for convenient tool calls.

## 10. Internal Hashing

Hashes SHALL be computed internally by the MCP server.

The agent SHALL NOT be required to compute, copy, or pass hashes.

### Hash Purposes

Hashes SHALL be used to:

```text
Detect file changes between preview and execution.
Detect file changes between execution and undo.
Verify selected line range stability.
Support safe refusal instead of silent corruption.
```

### Required Hashes

For a previewed operation, the server SHALL store:

```text
source_file_hash_before
dest_file_hash_before
selected_range_hash_before
```

For an executed operation, the server SHOULD store:

```text
source_file_hash_after
dest_file_hash_after
```

### Hash Algorithm

The implementation SHOULD use SHA-256 over exact file bytes or exact normalized internal file representation.

The selected range hash SHOULD be computed over the exact selected source lines as interpreted by the server.

### Agent-Facing Behavior

The server MAY return hashes in debug mode, but SHALL NOT require them in normal workflows.

Normal workflow SHALL use:

```text
operation_id only
```

## 11. Snapshot and Undo Model

Before every mutating operation, the server SHALL create exact pre-operation snapshots for every file that may be modified.

Snapshots SHALL store exact content sufficient to restore the files byte-for-byte.

### Snapshot Storage

The server SHOULD store operation data in a project-local metadata directory, for example:

```text
.mcp-line-mover/
  operations/
  snapshots/
```

The exact storage layout is implementation-defined.

### Snapshot Requirements

```text
Snapshots SHALL be local to the workspace.
Snapshots SHALL NOT be written outside the workspace root.
Snapshots SHALL include all files modified by an operation.
Snapshots SHALL be associated with operation_id.
Snapshots SHALL support exact restoration.
```

### Undo Safety

Undo SHALL restore snapshots only if the current files still match the post-operation state.

If current files changed after the operation, undo SHALL refuse by default.

The MVP SHALL NOT include force undo unless explicitly added later.

## 12. Path and Permission Model

The server SHALL treat filesystem access as sensitive.

### Workspace Root

The workspace root MAY be supplied in two modes:

- **Fixed mode** — `LINE_MOVER_ROOT` is set. The configured root is used for all
  tool calls. Behavior matches the original single-root model.
- **Inferred mode** — `LINE_MOVER_ROOT` is unset. Each tool call infers its
  workspace root from the supplied input paths (see §12.2).

All file operations SHALL be restricted to the resolved workspace root for that
call.

### Per-Call Root Inference

When `LINE_MOVER_ROOT` is unset, the server SHALL determine the workspace root
per tool call by walking up from each input path until a configured **root
marker** is found.

```text
Default marker: .git (file or directory)
Override:       LINE_MOVER_ROOT_MARKERS  (comma-separated, first match wins)
Walk depth:     LINE_MOVER_MAX_ROOT_WALK (default 25, hard cap 100)
```

Marker matching SHALL accept either a file or a directory at the candidate path
(this allows git worktrees, where `.git` is a file pointer).

The server SHALL refuse a tool call when:

- No marker is found within `LINE_MOVER_MAX_ROOT_WALK` levels of any input path.
- Multiple input paths infer to different workspace roots.
- The inferred root equals `os.homedir()`.

In all such cases the server SHALL return `PATH_OUTSIDE_WORKSPACE` with a
`recommended_action` describing remediation (typically "set `LINE_MOVER_ROOT`
explicitly" or "operate inside a marked directory").

### Cross-Call Operation Lookup

Operations created in inferred mode are stored under
`<inferred-root>/${LINE_MOVER_SNAPSHOT_DIR}/`. To allow `execute_operation` and
`undo_operation` to locate operations regardless of the current working
directory, the server SHALL maintain a **registry** at
`${LINE_MOVER_REGISTRY_DIR}/roots.log` (default
`<os.homedir()>/.mcp-line-mover/roots.log`).

The registry SHALL contain only absolute paths of workspace roots seen by the
server. It SHALL NOT contain operation data, hashes, or any other state.

Operation lookup SHALL try, in order:

```text
1. The inferred root from process.cwd().
2. Each registered root (pruning entries whose directories no longer exist).
```

If the same `operation_id` is found in multiple registered roots, the server
SHALL refuse with `OPERATION_NOT_FOUND` and surface the matched roots in the
error details.

### Path Resolution

The server SHALL resolve all requested paths to canonical absolute paths before validation.

The server SHALL reject:

```text
Paths outside workspace root.
Parent-directory traversal escaping workspace root.
Symlink escapes outside workspace root.
Absolute paths outside workspace root.
```

### Default Denylist

The server SHALL reject reads and writes for paths matching sensitive or generated areas.

Default denied paths SHOULD include:

```text
.git/**
node_modules/**
.env
**/.env
**/*.pem
**/*.key
```

The denylist SHOULD be configurable.

### File Type Restrictions

The server SHALL operate only on regular text files.

The server SHALL reject:

```text
Directories.
Binary files.
Device files.
Very large files exceeding configured maximum size.
```

## 13. Configuration

The server SHOULD support configuration through environment variables because MCP stdio configs commonly pass command, args, and env values.

Recommended configuration fields:

```text
LINE_MOVER_ROOT
LINE_MOVER_MAX_LINES
LINE_MOVER_MAX_FILE_SIZE_MB
LINE_MOVER_ALLOW_CREATE
LINE_MOVER_CREATE_PARENT_DIRS
LINE_MOVER_DENY_GLOBS
LINE_MOVER_SNAPSHOT_DIR
LINE_MOVER_OPERATION_TTL_DAYS
LINE_MOVER_ROOT_MARKERS
LINE_MOVER_MAX_ROOT_WALK
LINE_MOVER_REGISTRY_DIR
```

### Default Values

Recommended defaults:

```text
LINE_MOVER_ROOT             = unset (inferred mode; see §12.2)
LINE_MOVER_MAX_LINES        = 2000
LINE_MOVER_MAX_FILE_SIZE_MB = 5
LINE_MOVER_ALLOW_CREATE     = false
LINE_MOVER_CREATE_PARENT_DIRS = false
LINE_MOVER_SNAPSHOT_DIR     = .mcp-line-mover
LINE_MOVER_OPERATION_TTL_DAYS = 14
LINE_MOVER_ROOT_MARKERS     = .git
LINE_MOVER_MAX_ROOT_WALK    = 25
LINE_MOVER_REGISTRY_DIR     = <os.homedir()>/.mcp-line-mover
```

## 14. Line Handling Rules

Line numbers SHALL be 1-based.

`start_line` and `end_line` SHALL be inclusive.

`dest_line` SHALL be interpreted according to `placement`.

For `placement = "before"`:

```text
Insert selected lines before dest_line.
```

For `placement = "after"`:

```text
Insert selected lines after dest_line.
```

The server SHALL preserve the source text of moved lines exactly unless a future option explicitly requests transformation.

The server SHOULD preserve the destination file’s line ending style.

The server SHOULD preserve final newline convention.

## 15. Same-File Moves

The MVP MAY reject moves where `source_path` equals `dest_path`.

If same-file moves are supported, the server SHALL correctly account for line index shifts caused by removal before insertion.

The server SHALL reject same-file moves where the destination lies inside the moved range.

Recommended MVP behavior:

```text
Reject same-file moves with a clear error message.
```

## 16. Destination File Creation

If `dest_path` does not exist:

```text
create_dest_if_missing = true SHALL be required.
```

If destination parent directories do not exist:

```text
create_parent_dirs = true SHALL be required.
```

Destination file creation SHALL still respect workspace root and denylist rules.

## 17. Error Handling

All tools SHALL return structured errors.

Errors SHOULD include:

```text
ok: false
error_code
message
details
recommended_action
```

Recommended error codes:

```text
PATH_OUTSIDE_WORKSPACE
PATH_DENIED
SOURCE_NOT_FOUND
DEST_NOT_FOUND
INVALID_LINE_RANGE
DEST_LINE_OUT_OF_RANGE
FILE_TOO_LARGE
RANGE_TOO_LARGE
BINARY_FILE_REJECTED
OPERATION_NOT_FOUND
OPERATION_ALREADY_EXECUTED
OPERATION_NOT_UNDOABLE
FILE_CHANGED_SINCE_PREVIEW
FILE_CHANGED_SINCE_EXECUTION
SAME_FILE_MOVE_UNSUPPORTED
DESTINATION_INSIDE_SOURCE_RANGE
SNAPSHOT_WRITE_FAILED
WRITE_FAILED
```

## 18. Security Requirements

Because MCP stdio servers are local executable tools launched by agent clients, the package SHALL be treated as trusted local code. Recent public security discussion around MCP has emphasized that local server execution and tool access require careful trust and command hygiene. ([Tom's Hardware][3])

Therefore, the server SHALL:

```text
Avoid shell execution for core file operations.
Avoid arbitrary command execution tools.
Restrict filesystem access to workspace root.
Deny sensitive paths by default.
Validate all inputs with schemas.
Avoid returning large file contents by default.
Create snapshots before mutation.
Refuse stale preview execution.
Refuse unsafe undo when files changed after execution.
```

The server SHOULD:

```text
Limit maximum file size.
Limit maximum moved line count.
Use atomic write patterns where practical.
Use operation logs for auditability.
Avoid following symlinks outside the workspace.
```

## 19. Observability and Auditability

The server SHALL maintain operation metadata.

Operation metadata SHOULD include:

```text
timestamp
tool name
operation_id
paths involved
line range
moved line count
status
error code when failed
```

The server SHALL NOT log full moved content by default.

The server MAY provide a read-only `list_operations` tool in a future version.

## 20. Recommended Agent Workflow

### Safe Workflow

```text
1. Agent identifies source_path, start_line, end_line, dest_path, dest_line, placement.
2. Agent calls preview_move_lines.
3. Server returns operation_id and summary.
4. Agent calls execute_operation with operation_id.
5. Server internally validates hashes and applies move.
6. Agent runs normal repository checks using its existing shell/read tools.
7. If checks fail due to move placement or range, agent calls undo_operation.
```

### Low-Risk Shortcut Workflow

```text
1. Agent calls move_lines directly.
2. Server snapshots and applies move.
3. Agent validates result.
4. Agent calls undo_operation if needed.
```

## 21. Acceptance Criteria for MVP

The MVP SHALL be considered complete when:

```text
The package can be launched via npx as a stdio MCP server.
The server exposes preview_move_lines, execute_operation, move_lines, and undo_operation.
The agent can move a 100+ line range without providing source text.
The agent can execute a previewed operation using only operation_id.
The server refuses execution if source or destination changed since preview.
The server creates snapshots before mutation.
The server can undo a successful operation by restoring snapshots.
The server rejects paths outside the workspace.
The server rejects denied paths such as .git and node_modules.
The server preserves moved text exactly.
The server returns concise metadata and does not output full moved content by default.
```

## 22. Future Enhancements

Future versions MAY add:

```text
copy_lines
delete_lines
replace_lines
find_anchor
move_between_anchors
list_operations
operation cleanup
same-file moves
debug mode with optional small context snippets
Streamable HTTP transport
Git-aware warnings
```

Semantic refactoring, import rewriting, AST transformations, and language-server integration SHALL remain outside the scope unless this project intentionally evolves beyond line movement.
