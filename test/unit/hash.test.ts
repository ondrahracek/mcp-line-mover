import { describe, it, expect } from "vitest";
import { sha256, hashRange, EMPTY_SHA256 } from "../../src/core/hash.js";

describe("sha256", () => {
  it("matches the well-known empty-string vector", () => {
    expect(sha256(Buffer.from(""))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(EMPTY_SHA256).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches abc", () => {
    expect(sha256(Buffer.from("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is stable across calls", () => {
    const buf = Buffer.from("hello");
    expect(sha256(buf)).toBe(sha256(buf));
  });
});

describe("hashRange", () => {
  it("hashes the slice with eol terminators including final terminator", () => {
    const lines = ["a", "b", "c"];
    const expectedBytes = "b\nc\n";
    expect(hashRange(lines, 2, 3, "\n")).toBe(sha256(Buffer.from(expectedBytes)));
  });

  it("hashes single-line range", () => {
    expect(hashRange(["x", "y"], 1, 1, "\n")).toBe(sha256(Buffer.from("x\n")));
  });

  it("uses CRLF terminator when eol is CRLF", () => {
    expect(hashRange(["x", "y"], 1, 2, "\r\n")).toBe(sha256(Buffer.from("x\r\ny\r\n")));
  });

  it("is stable across calls", () => {
    const lines = ["a", "b", "c", "d"];
    expect(hashRange(lines, 1, 4, "\n")).toBe(hashRange(lines, 1, 4, "\n"));
  });
});
