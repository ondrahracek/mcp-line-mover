import { describe, it, expect } from "vitest";
import {
  extractRange,
  removeRange,
  insertAt,
  validateRange,
  validateDestLine,
  type Placement,
} from "../../src/core/lineMath.js";
import { AppError } from "../../src/core/errors.js";

describe("validateRange", () => {
  it("accepts in-bounds ranges", () => {
    expect(() => validateRange(1, 1, 5)).not.toThrow();
    expect(() => validateRange(1, 5, 5)).not.toThrow();
    expect(() => validateRange(3, 4, 5)).not.toThrow();
  });
  it("rejects start < 1", () => {
    expect(() => validateRange(0, 1, 5)).toThrow(AppError);
  });
  it("rejects end < start", () => {
    expect(() => validateRange(3, 2, 5)).toThrow(AppError);
  });
  it("rejects end > length", () => {
    expect(() => validateRange(1, 6, 5)).toThrow(AppError);
  });
  it("rejects on empty file", () => {
    expect(() => validateRange(1, 1, 0)).toThrow(AppError);
  });
  it("uses INVALID_LINE_RANGE code", () => {
    try {
      validateRange(0, 1, 5);
      expect.fail("should throw");
    } catch (e) {
      expect((e as AppError).code).toBe("INVALID_LINE_RANGE");
    }
  });
});

describe("validateDestLine", () => {
  describe("non-empty file (length=5)", () => {
    it.each([1, 2, 3, 4, 5, 6] as const)("before accepts %i", (n) => {
      expect(() => validateDestLine(n, 5, "before")).not.toThrow();
    });
    it.each([1, 2, 3, 4, 5] as const)("after accepts %i", (n) => {
      expect(() => validateDestLine(n, 5, "after")).not.toThrow();
    });
    it("before rejects 0", () => {
      expect(() => validateDestLine(0, 5, "before")).toThrow(AppError);
    });
    it("before rejects 7", () => {
      expect(() => validateDestLine(7, 5, "before")).toThrow(AppError);
    });
    it("after rejects 0", () => {
      expect(() => validateDestLine(0, 5, "after")).toThrow(AppError);
    });
    it("after rejects 6", () => {
      expect(() => validateDestLine(6, 5, "after")).toThrow(AppError);
    });
  });

  describe("empty file (length=0)", () => {
    it("before 1 is the only valid input", () => {
      expect(() => validateDestLine(1, 0, "before")).not.toThrow();
    });
    it("after rejects everything", () => {
      expect(() => validateDestLine(1, 0, "after")).toThrow(AppError);
      expect(() => validateDestLine(0, 0, "after")).toThrow(AppError);
    });
    it("before rejects 0 and 2", () => {
      expect(() => validateDestLine(0, 0, "before")).toThrow(AppError);
      expect(() => validateDestLine(2, 0, "before")).toThrow(AppError);
    });
  });

  it("uses DEST_LINE_OUT_OF_RANGE code", () => {
    try {
      validateDestLine(0, 5, "before");
      expect.fail("should throw");
    } catch (e) {
      expect((e as AppError).code).toBe("DEST_LINE_OUT_OF_RANGE");
    }
  });
});

describe("extractRange", () => {
  it("extracts inclusive range", () => {
    expect(extractRange(["a", "b", "c", "d"], 2, 3)).toEqual(["b", "c"]);
  });
  it("first single line", () => {
    expect(extractRange(["a", "b", "c"], 1, 1)).toEqual(["a"]);
  });
  it("last single line", () => {
    expect(extractRange(["a", "b", "c"], 3, 3)).toEqual(["c"]);
  });
  it("whole file", () => {
    expect(extractRange(["a", "b"], 1, 2)).toEqual(["a", "b"]);
  });
});

describe("removeRange", () => {
  it("removes inclusive range", () => {
    expect(removeRange(["a", "b", "c", "d"], 2, 3)).toEqual(["a", "d"]);
  });
  it("remove first", () => {
    expect(removeRange(["a", "b", "c"], 1, 1)).toEqual(["b", "c"]);
  });
  it("remove last", () => {
    expect(removeRange(["a", "b", "c"], 3, 3)).toEqual(["a", "b"]);
  });
  it("remove all", () => {
    expect(removeRange(["a", "b"], 1, 2)).toEqual([]);
  });
});

describe("insertAt", () => {
  const lines = ["x", "y", "z"];

  it.each([
    [1, "before" as Placement, ["P", "x", "y", "z"]],
    [2, "before" as Placement, ["x", "P", "y", "z"]],
    [3, "before" as Placement, ["x", "y", "P", "z"]],
    [4, "before" as Placement, ["x", "y", "z", "P"]],
    [1, "after" as Placement, ["x", "P", "y", "z"]],
    [2, "after" as Placement, ["x", "y", "P", "z"]],
    [3, "after" as Placement, ["x", "y", "z", "P"]],
  ])("dest=%i placement=%s -> %j", (dest, placement, expected) => {
    expect(insertAt(lines, dest, ["P"], placement)).toEqual(expected);
  });

  it("inserts multi-line payload", () => {
    expect(insertAt(["a", "b"], 1, ["P", "Q"], "after")).toEqual(["a", "P", "Q", "b"]);
  });

  it("inserts into empty file at before:1", () => {
    expect(insertAt([], 1, ["P", "Q"], "before")).toEqual(["P", "Q"]);
  });
});

describe("property: remove then insert reconstructs", () => {
  it("on disjoint same-array operation", () => {
    const orig = ["a", "b", "c", "d", "e"];
    const start = 2;
    const end = 4;
    const payload = extractRange(orig, start, end);
    const after = removeRange(orig, start, end);
    const reconstructed = insertAt(after, start, payload, "before");
    expect(reconstructed).toEqual(orig);
  });
});
