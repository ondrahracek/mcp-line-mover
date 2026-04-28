import { realpathSync, statSync } from "node:fs";
import { AppError } from "./errors.js";

export const DEFAULT_DENY_GLOBS: readonly string[] = Object.freeze([
  ".git/**",
  "node_modules/**",
  ".env",
  "**/.env",
  "**/*.pem",
  "**/*.key",
]);

export interface Config {
  readonly root: string;
  readonly maxLines: number;
  readonly maxFileSizeMb: number;
  readonly allowCreate: boolean;
  readonly createParentDirs: boolean;
  readonly snapshotDir: string;
  readonly operationTtlDays: number;
  readonly denyGlobs: readonly string[];
}

export type Env = Record<string, string | undefined>;

export function loadConfig(env: Env, fallbackCwd: string): Config {
  const rootInput = env.LINE_MOVER_ROOT ?? fallbackCwd;
  let root: string;
  try {
    const stat = statSync(rootInput);
    if (!stat.isDirectory()) {
      throw new AppError("INTERNAL_ERROR", `LINE_MOVER_ROOT is not a directory: ${rootInput}`);
    }
    root = realpathSync(rootInput);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("INTERNAL_ERROR", `LINE_MOVER_ROOT does not exist: ${rootInput}`, {
      cause: err,
    });
  }

  const maxLines = parsePositiveInt(env.LINE_MOVER_MAX_LINES, 2000, "LINE_MOVER_MAX_LINES");
  const maxFileSizeMb = parsePositiveInt(
    env.LINE_MOVER_MAX_FILE_SIZE_MB,
    5,
    "LINE_MOVER_MAX_FILE_SIZE_MB",
  );
  const operationTtlDays = parsePositiveInt(
    env.LINE_MOVER_OPERATION_TTL_DAYS,
    14,
    "LINE_MOVER_OPERATION_TTL_DAYS",
  );

  const allowCreate = parseBool(env.LINE_MOVER_ALLOW_CREATE);
  const createParentDirs = parseBool(env.LINE_MOVER_CREATE_PARENT_DIRS);

  const snapshotDir = (env.LINE_MOVER_SNAPSHOT_DIR ?? ".mcp-line-mover").trim() || ".mcp-line-mover";

  const userGlobs = (env.LINE_MOVER_DENY_GLOBS ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter((g) => g.length > 0);

  const denyGlobs = Object.freeze([
    ...DEFAULT_DENY_GLOBS,
    `${snapshotDir}/**`,
    ...userGlobs,
  ]);

  return Object.freeze({
    root,
    maxLines,
    maxFileSizeMb,
    allowCreate,
    createParentDirs,
    snapshotDir,
    operationTtlDays,
    denyGlobs,
  });
}

function parsePositiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === "") return fallback;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new AppError("INTERNAL_ERROR", `${name} must be a non-negative integer, got "${raw}"`);
  }
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new AppError("INTERNAL_ERROR", `${name} must be a non-negative integer, got "${raw}"`);
  }
  return n;
}

function parseBool(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}
