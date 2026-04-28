import { z } from "zod";

export const moveInputShape = {
  source_path: z.string().min(1).describe("Path to the source file (workspace-relative or absolute inside workspace)"),
  start_line: z.number().int().min(1).describe("1-based inclusive start of the source range"),
  end_line: z.number().int().min(1).describe("1-based inclusive end of the source range"),
  dest_path: z.string().min(1).describe("Path to the destination file"),
  dest_line: z.number().int().min(0).describe("1-based destination line; semantics depend on placement"),
  placement: z.enum(["before", "after"]).optional().default("after").describe("Insert before or after dest_line"),
  remove_from_source: z.boolean().optional().default(true).describe("Whether to remove the range from the source file"),
  create_dest_if_missing: z.boolean().optional().describe("Create dest file if it does not exist"),
  create_parent_dirs: z.boolean().optional().describe("Create dest parent directories if missing"),
  description: z.string().optional().describe("Optional human-readable description"),
};

export const moveInputSchema = z.object(moveInputShape);
export type MoveInput = z.infer<typeof moveInputSchema>;

export const executeInputShape = {
  operation_id: z.string().min(1).describe("Operation id returned by preview_move_lines"),
};
export const executeInputSchema = z.object(executeInputShape);
export type ExecuteInput = z.infer<typeof executeInputSchema>;

export const undoInputShape = {
  operation_id: z.string().min(1).optional().describe("Operation id to undo. If omitted, undoes the most recent executed op."),
};
export const undoInputSchema = z.object(undoInputShape);
export type UndoInput = z.infer<typeof undoInputSchema>;
