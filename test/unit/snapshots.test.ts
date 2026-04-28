import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, writeFileSync, chmodSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { snapshot, restore, snapshotExists } from "../../src/core/snapshots.js";
import { AppError } from "../../src/core/errors.js";
import { makeTmpWorkspace, type TmpWorkspace } from "../helpers/tmpWorkspace.js";

let ws: TmpWorkspace;
beforeEach(() => {
  ws = makeTmpWorkspace();
});
afterEach(() => ws.cleanup());

describe("snapshot", () => {
  it("writes manifest + numbered files in op subdir", () => {
    ws.write("a.txt", "alpha");
    ws.write("nested/b.txt", "beta");
    snapshot("OP1", [join(ws.root, "a.txt"), join(ws.root, "nested/b.txt")], ws.root, ws.config);
    const dir = join(ws.root, ".mcp-line-mover", "snapshots", "OP1");
    expect(existsSync(join(dir, "manifest.json"))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    expect(manifest.entries.length).toBe(2);
    for (const entry of manifest.entries) {
      expect(existsSync(join(dir, entry.snapshotFile))).toBe(true);
    }
  });

  it("snapshot bytes are byte-identical to source", () => {
    ws.write("a.txt", "alpha\nwith\nlines\n");
    snapshot("OP2", [join(ws.root, "a.txt")], ws.root, ws.config);
    const dir = join(ws.root, ".mcp-line-mover", "snapshots", "OP2");
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    const snapBytes = readFileSync(join(dir, manifest.entries[0].snapshotFile));
    expect(snapBytes.equals(Buffer.from("alpha\nwith\nlines\n"))).toBe(true);
  });

  it("snapshot filename is short and does not leak path components", () => {
    ws.write("deep/nested/path/with-spaces/file.txt", "x");
    snapshot("OP3", [join(ws.root, "deep/nested/path/with-spaces/file.txt")], ws.root, ws.config);
    const dir = join(ws.root, ".mcp-line-mover", "snapshots", "OP3");
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    const snap = manifest.entries[0].snapshotFile;
    expect(snap).toMatch(/^\d+\.bin$/);
    expect(snap).not.toContain("nested");
    expect(snap).not.toContain("with-spaces");
  });

  it("creates the directory lazily and is idempotent on rerun", () => {
    ws.write("a.txt", "v1");
    snapshot("OP4", [join(ws.root, "a.txt")], ws.root, ws.config);
    writeFileSync(join(ws.root, "a.txt"), "v2");
    snapshot("OP4", [join(ws.root, "a.txt")], ws.root, ws.config);
    const dir = join(ws.root, ".mcp-line-mover", "snapshots", "OP4");
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    expect(readFileSync(join(dir, manifest.entries[0].snapshotFile), "utf8")).toBe("v2");
  });

  it("snapshot of missing source throws SNAPSHOT_WRITE_FAILED", () => {
    try {
      snapshot("OP5", [join(ws.root, "missing.txt")], ws.root, ws.config);
      expect.fail("should throw");
    } catch (e) {
      expect((e as AppError).code).toBe("SNAPSHOT_WRITE_FAILED");
    }
  });

  it("snapshot is rejected for paths outside workspace", () => {
    expect(() => snapshot("OP6", ["/etc/passwd"], ws.root, ws.config)).toThrow(AppError);
  });
});

describe("snapshotExists", () => {
  it("returns true after snapshot, false otherwise", () => {
    expect(snapshotExists("NONE", ws.root, ws.config)).toBe(false);
    ws.write("a.txt", "x");
    snapshot("OP7", [join(ws.root, "a.txt")], ws.root, ws.config);
    expect(snapshotExists("OP7", ws.root, ws.config)).toBe(true);
  });
});

describe("restore", () => {
  it("restores byte-identical content", () => {
    const orig = "alpha\r\nbeta\r\n";
    ws.write("a.txt", orig);
    snapshot("OPR", [join(ws.root, "a.txt")], ws.root, ws.config);
    writeFileSync(join(ws.root, "a.txt"), "MUTATED");
    restore("OPR", ws.root, ws.config);
    expect(readFileSync(join(ws.root, "a.txt"), "utf8")).toBe(orig);
  });

  it("restores all snapshotted files", () => {
    ws.write("a.txt", "A1");
    ws.write("b.txt", "B1");
    snapshot("OPR2", [join(ws.root, "a.txt"), join(ws.root, "b.txt")], ws.root, ws.config);
    writeFileSync(join(ws.root, "a.txt"), "A2");
    writeFileSync(join(ws.root, "b.txt"), "B2");
    restore("OPR2", ws.root, ws.config);
    expect(readFileSync(join(ws.root, "a.txt"), "utf8")).toBe("A1");
    expect(readFileSync(join(ws.root, "b.txt"), "utf8")).toBe("B1");
  });

  it("returns the list of restored absolute paths", () => {
    ws.write("a.txt", "A");
    snapshot("OPR3", [join(ws.root, "a.txt")], ws.root, ws.config);
    const restored = restore("OPR3", ws.root, ws.config);
    expect(restored).toEqual([join(ws.root, "a.txt")]);
  });

  it("throws when snapshot directory missing", () => {
    expect(() => restore("MISSING", ws.root, ws.config)).toThrow(AppError);
  });
});
