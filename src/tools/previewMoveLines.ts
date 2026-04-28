import { basename } from "node:path";
import { toEnvelope, type ErrorEnvelope } from "../core/errors.js";
import { createOperation } from "../core/operations.js";
import type { Config } from "../core/config.js";
import { moveInputSchema, type MoveInput } from "../schemas.js";
import { validateMove } from "./validateMove.js";

export interface PreviewSuccess {
  ok: true;
  operation_id: string;
  summary: string;
  source_path: string;
  dest_path: string;
  start_line: number;
  end_line: number;
  dest_line: number;
  placement: "before" | "after";
  moved_line_count: number;
  warnings: string[];
}

export type PreviewResult = PreviewSuccess | ErrorEnvelope;

export function previewMoveLines(rawInput: unknown, config: Config): PreviewResult {
  try {
    const parsed = moveInputSchema.parse(rawInput) as MoveInput;
    const v = validateMove(parsed, config);

    const warnings: string[] = [];
    if (!v.destExisted) warnings.push("destination file will be created on execution");
    if (v.sourceFile.eol !== v.destFile.eol && v.destExisted) {
      warnings.push(
        `line endings differ (source ${eolName(v.sourceFile.eol)}, dest ${eolName(v.destFile.eol)}); inserted block will use dest line endings`,
      );
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

    return {
      ok: true,
      operation_id: op.operation_id,
      summary: buildSummary(v),
      source_path: v.input.source_path,
      dest_path: v.input.dest_path,
      start_line: v.input.start_line,
      end_line: v.input.end_line,
      dest_line: v.input.dest_line,
      placement: v.input.placement,
      moved_line_count: v.movedLineCount,
      warnings,
    };
  } catch (err) {
    return toEnvelope(err);
  }
}

function buildSummary(v: ReturnType<typeof validateMove>): string {
  return `Preview: move ${v.movedLineCount} line(s) from ${basename(v.sourceAbs)}:${v.input.start_line}-${v.input.end_line} -> ${basename(v.destAbs)} ${v.input.placement} line ${v.input.dest_line}`;
}

function eolName(eol: "\n" | "\r\n"): string {
  return eol === "\r\n" ? "CRLF" : "LF";
}
