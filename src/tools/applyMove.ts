import { existsSync, readFileSync } from "node:fs";
import { AppError } from "../core/errors.js";
// Imported as namespace so tests can spy on writeAtomic via vi.spyOn(filesMod, ...).
import * as filesMod from "../core/files.js";
import { sha256 } from "../core/hash.js";
import { extractRange, removeRange, insertAt } from "../core/lineMath.js";
import { snapshot, restore } from "../core/snapshots.js";
import type { Config } from "../core/config.js";
import type { ValidatedMove } from "./validateMove.js";

export interface AppliedMove {
  files_changed: string[];
  source_file_hash_after: string;
  dest_file_hash_after: string;
}

export function applyMove(
  operationId: string,
  v: ValidatedMove,
  root: string,
  config: Config,
): AppliedMove {
  const filesToSnapshot = [v.sourceAbs];
  if (v.destExisted) filesToSnapshot.push(v.destAbs);
  snapshot(operationId, filesToSnapshot, root, config);

  const movedPayload = extractRange(v.sourceFile.lines, v.input.start_line, v.input.end_line);

  let nextSourceLines = v.sourceFile.lines;
  if (v.input.remove_from_source) {
    nextSourceLines = removeRange(v.sourceFile.lines, v.input.start_line, v.input.end_line);
  }

  const nextDestLines = insertAt(
    v.destFile.lines,
    v.input.dest_line,
    movedPayload,
    v.input.placement,
  );

  const sourceFinalNewline = nextSourceLines.length === 0 ? false : v.sourceFile.finalNewline;
  const destFinalNewline = nextDestLines.length === 0 ? false : v.destFile.finalNewline || !v.destExisted;

  const sourceContent = filesMod.serializeLines(nextSourceLines, v.sourceFile.eol, sourceFinalNewline);
  const destContent = filesMod.serializeLines(
    nextDestLines,
    v.destExisted ? v.destFile.eol : v.sourceFile.eol,
    destFinalNewline,
  );

  const writtenFiles: string[] = [];
  try {
    if (v.input.remove_from_source) {
      filesMod.writeAtomic(v.sourceAbs, sourceContent);
      writtenFiles.push(v.sourceAbs);
    }
    filesMod.writeAtomic(v.destAbs, destContent, { mkdirs: v.input.create_parent_dirs });
    writtenFiles.push(v.destAbs);
  } catch (err) {
    try {
      restore(operationId, root, config);
    } catch {
      // nested failure during rollback; original error wins
    }
    if (err instanceof AppError) throw err;
    throw new AppError("WRITE_FAILED", `Failed during move execution`, {
      details: { wrote: writtenFiles },
      cause: err,
    });
  }

  const sourceAfterBytes = existsSync(v.sourceAbs) ? readFileSync(v.sourceAbs) : Buffer.alloc(0);
  const destAfterBytes = readFileSync(v.destAbs);
  return {
    files_changed: dedup([
      ...(v.input.remove_from_source ? [v.sourceAbs] : []),
      v.destAbs,
    ]),
    source_file_hash_after: sha256(sourceAfterBytes),
    dest_file_hash_after: sha256(destAfterBytes),
  };
}

function dedup<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
