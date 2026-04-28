import { createHash } from "node:crypto";
import type { Eol } from "./files.js";

export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function sha256(bytes: Buffer | string): string {
  return createHash("sha256")
    .update(typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes)
    .digest("hex");
}

export function hashRange(lines: readonly string[], start: number, end: number, eol: Eol): string {
  const slice = lines.slice(start - 1, end);
  const text = slice.join(eol) + eol;
  return sha256(text);
}
