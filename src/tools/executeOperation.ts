import { existsSync } from "node:fs";
import { AppError, toEnvelope, type ErrorEnvelope } from "../core/errors.js";
import { updateOperation, loadOperation } from "../core/operations.js";
import { locateOperation } from "../core/operationLocator.js";
import { resolveUserPath, pathsAreSame } from "../core/paths.js";
import { readTextFile, parseTextBytes } from "../core/files.js";
import { sha256, EMPTY_SHA256, hashRange } from "../core/hash.js";
import { applyMove } from "./applyMove.js";
import type { ValidatedMove } from "./validateMove.js";
import type { Config } from "../core/config.js";
import { executeInputSchema } from "../schemas.js";

export interface ExecuteSuccess {
  ok: true;
  operation_id: string;
  files_changed: string[];
  moved_line_count: number;
  undo_available: boolean;
  warnings: string[];
  suggested_next_steps: string[];
}

export type ExecuteResult = ExecuteSuccess | ErrorEnvelope;

export function executeOperation(rawInput: unknown, config: Config): ExecuteResult {
  let opId: string | undefined;
  let workspaceRoot: string | undefined;
  try {
    const input = executeInputSchema.parse(rawInput);
    opId = input.operation_id;
    const located = locateOperation(input.operation_id, config);
    const op = located.record;
    workspaceRoot = located.workspace.root;

    if (op.status === "expired") {
      throw new AppError("OPERATION_NOT_FOUND", `Operation ${input.operation_id} has expired`, {
        recommendedAction: "re-run preview_move_lines",
      });
    }
    if (op.status === "executed") {
      throw new AppError(
        "OPERATION_ALREADY_EXECUTED",
        `Operation ${input.operation_id} has already been executed`,
        { details: { operation_id: input.operation_id } },
      );
    }
    if (op.status !== "previewed") {
      throw new AppError(
        "OPERATION_NOT_FOUND",
        `Operation ${input.operation_id} is in non-executable status: ${op.status}`,
      );
    }

    const sourceAbs = resolveUserPath(op.source_path, workspaceRoot, config);
    const destAbs = resolveUserPath(op.dest_path, workspaceRoot, config);
    if (pathsAreSame(sourceAbs, destAbs)) {
      throw new AppError("SAME_FILE_MOVE_UNSUPPORTED", "Same-file moves are not supported");
    }

    const sourceFile = readTextFile(sourceAbs, config);
    const destExisted = existsSync(destAbs);
    const destFile = destExisted ? readTextFile(destAbs, config) : parseTextBytes(Buffer.alloc(0));

    const sourceFileHash = sha256(sourceFile.bytes);
    const destFileHash = destExisted ? sha256(destFile.bytes) : EMPTY_SHA256;
    const rangeHash = hashRange(sourceFile.lines, op.start_line, op.end_line, sourceFile.eol);

    if (sourceFileHash !== op.source_file_hash_before) {
      throw new AppError("FILE_CHANGED_SINCE_PREVIEW", `Source file changed since preview`, {
        details: { path: op.source_path },
        recommendedAction: "re-run preview_move_lines",
      });
    }
    if (destFileHash !== op.dest_file_hash_before) {
      throw new AppError("FILE_CHANGED_SINCE_PREVIEW", `Destination file changed since preview`, {
        details: { path: op.dest_path },
        recommendedAction: "re-run preview_move_lines",
      });
    }
    if (rangeHash !== op.selected_range_hash_before) {
      throw new AppError(
        "FILE_CHANGED_SINCE_PREVIEW",
        `Selected range bytes changed since preview`,
        { recommendedAction: "re-run preview_move_lines" },
      );
    }

    const v: ValidatedMove = {
      input: {
        source_path: op.source_path,
        start_line: op.start_line,
        end_line: op.end_line,
        dest_path: op.dest_path,
        dest_line: op.dest_line,
        placement: op.placement,
        remove_from_source: op.remove_from_source,
        create_dest_if_missing: op.create_dest_if_missing,
        create_parent_dirs: op.create_parent_dirs,
        ...(op.description !== undefined ? { description: op.description } : {}),
      },
      sourceAbs,
      destAbs,
      sourceFile,
      destFile,
      destExisted,
      sourceFileHash,
      destFileHash,
      rangeHash,
      movedLineCount: op.moved_line_count,
    };

    const applied = applyMove(op.operation_id, v, workspaceRoot, config);

    updateOperation(
      op.operation_id,
      op.updated_at,
      {
        status: "executed",
        source_file_hash_after: applied.source_file_hash_after,
        dest_file_hash_after: applied.dest_file_hash_after,
      },
      workspaceRoot,
      config,
    );

    return {
      ok: true,
      operation_id: op.operation_id,
      files_changed: applied.files_changed,
      moved_line_count: op.moved_line_count,
      undo_available: true,
      warnings: op.warnings,
      suggested_next_steps: [
        "Run formatter on changed files.",
        "Run typecheck and tests.",
        `Inspect ${op.dest_path} around line ${op.dest_line}.`,
      ],
    };
  } catch (err) {
    if (err instanceof AppError && opId && workspaceRoot) {
      try {
        const op = loadOperation(opId, workspaceRoot, config);
        if (op.status === "previewed") {
          updateOperation(
            opId,
            op.updated_at,
            { status: "failed", error: { code: err.code, message: err.message } },
            workspaceRoot,
            config,
          );
        }
      } catch {
        // best-effort
      }
    }
    return toEnvelope(err);
  }
}
