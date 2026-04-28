import { existsSync, readFileSync } from "node:fs";
import { AppError, toEnvelope, type ErrorEnvelope } from "../core/errors.js";
import { loadOperation, listOperations, updateOperation } from "../core/operations.js";
import { resolveUserPath } from "../core/paths.js";
import { restore, snapshotExists } from "../core/snapshots.js";
import { sha256, EMPTY_SHA256 } from "../core/hash.js";
import type { Config } from "../core/config.js";
import { undoInputSchema } from "../schemas.js";

export interface UndoSuccess {
  ok: true;
  operation_id: string;
  restored_files: string[];
  warnings: string[];
}

export type UndoResult = UndoSuccess | ErrorEnvelope;

export function undoOperation(rawInput: unknown, config: Config): UndoResult {
  try {
    const input = undoInputSchema.parse(rawInput);

    let opId = input.operation_id;
    if (!opId) {
      const ops = listOperations(config).filter((o) => o.status === "executed");
      if (ops.length === 0) {
        throw new AppError(
          "OPERATION_NOT_FOUND",
          "No executed operation available to undo",
          { recommendedAction: "specify operation_id explicitly" },
        );
      }
      opId = ops[0]!.operation_id;
    }

    const op = loadOperation(opId, config);

    if (op.status !== "executed") {
      throw new AppError(
        "OPERATION_NOT_UNDOABLE",
        `Operation ${opId} is in status "${op.status}"; only executed operations can be undone`,
        { details: { operation_id: opId, status: op.status } },
      );
    }

    if (!snapshotExists(opId, config)) {
      throw new AppError(
        "OPERATION_NOT_UNDOABLE",
        `Snapshot missing for operation ${opId}`,
        { details: { operation_id: opId } },
      );
    }

    const sourceAbs = resolveUserPath(op.source_path, config);
    const destAbs = resolveUserPath(op.dest_path, config);

    const sourceCurrentHash = existsSync(sourceAbs) ? sha256(readFileSync(sourceAbs)) : EMPTY_SHA256;
    const destCurrentHash = existsSync(destAbs) ? sha256(readFileSync(destAbs)) : EMPTY_SHA256;

    if (op.source_file_hash_after && sourceCurrentHash !== op.source_file_hash_after) {
      throw new AppError(
        "FILE_CHANGED_SINCE_EXECUTION",
        `Source file changed since operation execution`,
        {
          details: { path: op.source_path },
          recommendedAction: "manual reconciliation required; undo refused",
        },
      );
    }
    if (op.dest_file_hash_after && destCurrentHash !== op.dest_file_hash_after) {
      throw new AppError(
        "FILE_CHANGED_SINCE_EXECUTION",
        `Destination file changed since operation execution`,
        {
          details: { path: op.dest_path },
          recommendedAction: "manual reconciliation required; undo refused",
        },
      );
    }

    const restored = restore(opId, config);
    updateOperation(opId, op.updated_at, { status: "undone" }, config);

    return {
      ok: true,
      operation_id: opId,
      restored_files: restored,
      warnings: [],
    };
  } catch (err) {
    return toEnvelope(err);
  }
}
