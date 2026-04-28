import { expect } from "vitest";

const FORBIDDEN_KEYS = [
  "selected_text",
  "moved_text",
  "content",
  "lines",
  "text",
  "source_lines",
  "dest_lines",
  "snippet",
];

export function assertNoLeakedContent(value: unknown, path = "$"): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoLeakedContent(v, `${path}[${i}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.includes(k)) {
        expect.fail(`Response leaked content via field "${k}" at ${path}`);
      }
      assertNoLeakedContent(v, `${path}.${k}`);
    }
  }
}
