import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { moveLines } from "../../src/tools/moveLines.js";
import { loadOperation } from "../../src/core/operations.js";
import { assertNoLeakedContent } from "../helpers/assertNoLeakedContent.js";
import { makeTmpWorkspace, type TmpWorkspace } from "../helpers/tmpWorkspace.js";

let ws: TmpWorkspace;
beforeEach(() => {
  ws = makeTmpWorkspace();
});
afterEach(() => ws.cleanup());

describe("moveLines happy path", () => {
  it("performs preview+execute in one shot", () => {
    ws.write("a.txt", "S1\nS2\nS3\nS4\nS5\n");
    ws.write("b.txt", "X1\nX2\n");

    const r = moveLines(
      {
        source_path: "a.txt",
        start_line: 2,
        end_line: 3,
        dest_path: "b.txt",
        dest_line: 1,
        placement: "after",
        remove_from_source: true,
      },
      ws.config,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.operation_id).toMatch(/^[0-9A-Z]+$/);
    expect(ws.read("a.txt").toString()).toBe("S1\nS4\nS5\n");
    expect(ws.read("b.txt").toString()).toBe("X1\nS2\nS3\nX2\n");
    const op = loadOperation(r.operation_id, ws.config);
    expect(op.status).toBe("executed");
  });

  it("response leaks no content", () => {
    ws.write("a.txt", "S1\nS2\n");
    ws.write("b.txt", "X1\n");
    const r = moveLines(
      {
        source_path: "a.txt",
        start_line: 1,
        end_line: 1,
        dest_path: "b.txt",
        dest_line: 1,
        placement: "after",
        remove_from_source: true,
      },
      ws.config,
    );
    assertNoLeakedContent(r);
  });
});

describe("moveLines error paths", () => {
  it("validation error: invalid range", () => {
    ws.write("a.txt", "x\n");
    ws.write("b.txt", "y\n");
    const r = moveLines(
      {
        source_path: "a.txt",
        start_line: 1,
        end_line: 99,
        dest_path: "b.txt",
        dest_line: 1,
        placement: "after",
        remove_from_source: true,
      },
      ws.config,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error_code).toBe("INVALID_LINE_RANGE");
  });

  it("rolls back files when write fails mid-execution", async () => {
    ws.write("a.txt", "A1\nA2\nA3\n");
    ws.write("b.txt", "B1\nB2\n");

    const filesMod = await import("../../src/core/files.js");
    let writeCount = 0;
    const realWrite = filesMod.writeAtomic;
    const spy = vi.spyOn(filesMod, "writeAtomic").mockImplementation((path, content, opts) => {
      writeCount++;
      if (writeCount === 3) {
        // Counts: 1=op record write, 2=snapshot manifest, 3=first file write
        throw new Error("simulated mid-write failure");
      }
      return realWrite(path, content, opts);
    });

    let r;
    try {
      r = moveLines(
        {
          source_path: "a.txt",
          start_line: 1,
          end_line: 1,
          dest_path: "b.txt",
          dest_line: 1,
          placement: "after",
          remove_from_source: true,
        },
        ws.config,
      );
    } finally {
      spy.mockRestore();
    }

    expect(r.ok).toBe(false);
    expect(ws.read("a.txt").toString()).toBe("A1\nA2\nA3\n");
    expect(ws.read("b.txt").toString()).toBe("B1\nB2\n");
  });
});
