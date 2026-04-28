import { describe, it, expect } from "vitest";
import { AppError, ERROR_CODES, toEnvelope } from "../../src/core/errors.js";

describe("AppError + envelope", () => {
  it("round-trips into the spec error envelope", () => {
    const err = new AppError("PATH_DENIED", "blocked", {
      details: { path: ".env" },
      recommendedAction: "use a non-secret path",
    });
    const env = toEnvelope(err);
    expect(env).toEqual({
      ok: false,
      error_code: "PATH_DENIED",
      message: "blocked",
      details: { path: ".env" },
      recommended_action: "use a non-secret path",
    });
  });

  it("omits details and recommended_action when not provided", () => {
    const env = toEnvelope(new AppError("WRITE_FAILED", "boom"));
    expect(env).toEqual({
      ok: false,
      error_code: "WRITE_FAILED",
      message: "boom",
    });
  });

  it("wraps non-AppError as INTERNAL_ERROR without leaking stack", () => {
    const env = toEnvelope(new Error("oops\n  at internal:42"));
    expect(env.ok).toBe(false);
    expect(env.error_code).toBe("INTERNAL_ERROR");
    expect(env.message).toBe("oops");
    expect(JSON.stringify(env)).not.toContain("internal:42");
  });

  it("wraps non-Error throwables", () => {
    const env = toEnvelope("plain string");
    expect(env.error_code).toBe("INTERNAL_ERROR");
    expect(env.message).toBe("plain string");
  });
});

describe("error code catalog", () => {
  const required = [
    "PATH_OUTSIDE_WORKSPACE",
    "PATH_DENIED",
    "SOURCE_NOT_FOUND",
    "DEST_NOT_FOUND",
    "INVALID_LINE_RANGE",
    "DEST_LINE_OUT_OF_RANGE",
    "FILE_TOO_LARGE",
    "RANGE_TOO_LARGE",
    "BINARY_FILE_REJECTED",
    "OPERATION_NOT_FOUND",
    "OPERATION_ALREADY_EXECUTED",
    "OPERATION_NOT_UNDOABLE",
    "FILE_CHANGED_SINCE_PREVIEW",
    "FILE_CHANGED_SINCE_EXECUTION",
    "SAME_FILE_MOVE_UNSUPPORTED",
    "DESTINATION_INSIDE_SOURCE_RANGE",
    "SNAPSHOT_WRITE_FAILED",
    "WRITE_FAILED",
    "INTERNAL_ERROR",
  ] as const;

  it.each(required)("exports code %s", (code) => {
    expect(ERROR_CODES).toContain(code);
  });
});
