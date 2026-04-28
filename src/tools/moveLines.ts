import { toEnvelope, type ErrorEnvelope } from "../core/errors.js";
import { createOperation, updateOperation, loadOperation } from "../core/operations.js";
import type { Config } from "../core/config.js";
import { moveInputSchema, type MoveInput } from "../schemas.js";
import { validateMove } from "./validateMove.js";
import { applyMove } from "./applyMove.js";

export interface MoveSuccess {
  ok: true;
  operation_id: string;
  files_changed: string[];
  moved_line_count: number;
  undo_available: boolean;
  warnings: string[];
  suggested_next_steps: string[];
}

export type MoveResult = MoveSuccess | ErrorEnvelope;

export function moveLines(rawInput: unknown, config: Config): MoveResult {
  let opId: string | undefined;
  try {
    const parsed = moveInputSchema.parse(rawInput) as MoveInput;
    const v = validateMove(parsed, config);

    const warnings: string[] = [];
    if (!v.destExisted) warnings.push("destination file created");
    if (v.sourceFile.eol !== v.destFile.eol && v.destExisted) {
      warnings.push("inserted block normalized to dest line endings");
    }

    const op = createOperation(
      {
        description: v.input.description,
        source_path: v.input.source_path,
        start_line: v.input.start_line,
        end_line: v.input.end_line,
        dest_path: v.input.dest_path,
        dest_line: v.input.dest_line,
        placement: v.input.placement,
        remove_from_source: v.input.remove_from_source,
        create_dest_if_missing: v.input.create_dest_if_missing,
        create_parent_dirs: v.input.create_parent_dirs,
        moved_line_count: v.movedLineCount,
        source_file_hash_before: v.sourceFileHash,
        dest_file_hash_before: v.destFileHash,
        selected_range_hash_before: v.rangeHash,
        warnings,
      },
      config,
    );
    opId = op.operation_id;

    const applied = applyMove(op.operation_id, v, config);

    updateOperation(
      op.operation_id,
      op.updated_at,
      {
        status: "executed",
        source_file_hash_after: applied.source_file_hash_after,
        dest_file_hash_after: applied.dest_file_hash_after,
      },
      config,
    );

    return {
      ok: true,
      operation_id: op.operation_id,
      files_changed: applied.files_changed,
      moved_line_count: v.movedLineCount,
      undo_available: true,
      warnings,
      suggested_next_steps: [
        "Run formatter on changed files.",
        "Run typecheck and tests.",
        `Inspect ${v.input.dest_path} around line ${v.input.dest_line}.`,
      ],
    };
  } catch (err) {
    if (opId) {
      try {
        const reloaded = loadOperation(opId, config);
        if (reloaded.status === "previewed") {
          updateOperation(
            opId,
            reloaded.updated_at,
            {
              status: "failed",
              error: {
                code: (err as { code?: string }).code ?? "INTERNAL_ERROR",
                message: (err as Error).message ?? String(err),
              },
            },
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
