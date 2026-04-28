export const ERROR_CODES = [
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

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorEnvelope {
  ok: false;
  error_code: ErrorCode;
  message: string;
  details?: unknown;
  recommended_action?: string;
}

export interface AppErrorOptions {
  details?: unknown;
  recommendedAction?: string;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly recommendedAction?: string;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.details = options.details;
    this.recommendedAction = options.recommendedAction;
  }
}

export function toEnvelope(err: unknown): ErrorEnvelope {
  if (err instanceof AppError) {
    const env: ErrorEnvelope = {
      ok: false,
      error_code: err.code,
      message: err.message,
    };
    if (err.details !== undefined) env.details = err.details;
    if (err.recommendedAction !== undefined) env.recommended_action = err.recommendedAction;
    return env;
  }
  const message =
    err instanceof Error
      ? (err.message.split("\n")[0] ?? "internal error")
      : typeof err === "string"
        ? err
        : "internal error";
  return { ok: false, error_code: "INTERNAL_ERROR", message };
}
