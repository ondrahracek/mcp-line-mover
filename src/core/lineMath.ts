import { AppError } from "./errors.js";

export type Placement = "before" | "after";

export function validateRange(start: number, end: number, length: number): void {
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new AppError("INVALID_LINE_RANGE", `start_line and end_line must be integers`);
  }
  if (start < 1) {
    throw new AppError("INVALID_LINE_RANGE", `start_line must be >= 1, got ${start}`);
  }
  if (end < start) {
    throw new AppError("INVALID_LINE_RANGE", `end_line (${end}) must be >= start_line (${start})`);
  }
  if (length === 0) {
    throw new AppError("INVALID_LINE_RANGE", `cannot select range from empty file`);
  }
  if (end > length) {
    throw new AppError(
      "INVALID_LINE_RANGE",
      `end_line (${end}) exceeds source line count (${length})`,
    );
  }
}

export function validateDestLine(destLine: number, length: number, placement: Placement): void {
  if (!Number.isInteger(destLine)) {
    throw new AppError("DEST_LINE_OUT_OF_RANGE", `dest_line must be an integer`);
  }
  const { min, max } = destLineDomain(length, placement);
  if (min > max) {
    throw new AppError(
      "DEST_LINE_OUT_OF_RANGE",
      `placement "${placement}" is not valid for an empty file; use placement="before" with dest_line=1`,
    );
  }
  if (destLine < min || destLine > max) {
    throw new AppError(
      "DEST_LINE_OUT_OF_RANGE",
      `dest_line ${destLine} out of range for placement "${placement}" on file of ${length} line(s); valid: ${min}..${max}`,
    );
  }
}

export function destLineDomain(length: number, placement: Placement): { min: number; max: number } {
  if (placement === "before") {
    return length === 0 ? { min: 1, max: 1 } : { min: 1, max: length + 1 };
  }
  return { min: 1, max: length };
}

export function extractRange(lines: readonly string[], start: number, end: number): string[] {
  return lines.slice(start - 1, end);
}

export function removeRange(lines: readonly string[], start: number, end: number): string[] {
  return [...lines.slice(0, start - 1), ...lines.slice(end)];
}

export function insertAt(
  lines: readonly string[],
  destLine: number,
  payload: readonly string[],
  placement: Placement,
): string[] {
  const idx = placement === "before" ? destLine - 1 : destLine;
  return [...lines.slice(0, idx), ...payload, ...lines.slice(idx)];
}
