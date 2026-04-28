import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { AppError } from "./errors.js";
import { writeAtomic } from "./files.js";
import { resolveInternalPath } from "./paths.js";
import type { Config } from "./config.js";
import type { Placement } from "./lineMath.js";

export type OperationStatus = "previewed" | "executed" | "failed" | "undone" | "expired";

export interface OperationRecord {
  operation_id: string;
  created_at: string;
  updated_at: string;
  status: OperationStatus;
  description?: string;
  workspace_root: string;
  source_path: string;
  start_line: number;
  end_line: number;
  dest_path: string;
  dest_line: number;
  placement: Placement;
  remove_from_source: boolean;
  create_dest_if_missing: boolean;
  create_parent_dirs: boolean;
  moved_line_count: number;
  source_file_hash_before: string;
  dest_file_hash_before: string;
  selected_range_hash_before: string;
  source_file_hash_after?: string;
  dest_file_hash_after?: string;
  warnings: string[];
  error?: { code: string; message: string };
}

export type OperationInput = Omit<
  OperationRecord,
  "operation_id" | "created_at" | "updated_at" | "status" | "workspace_root"
>;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateOperationId(): string {
  const buf = randomBytes(8);
  let n = 0n;
  for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(buf[i] ?? 0);
  let out = "";
  for (let i = 0; i < 13; i++) {
    out = CROCKFORD[Number(n & 31n)] + out;
    n >>= 5n;
  }
  return out;
}

export function operationsDir(root: string, config: Config): string {
  return resolveInternalPath(join(config.snapshotDir, "operations"), root);
}

export function operationFile(id: string, root: string, config: Config): string {
  return resolveInternalPath(join(config.snapshotDir, "operations", `${id}.json`), root);
}

export function createOperation(
  input: OperationInput,
  root: string,
  config: Config,
): OperationRecord {
  const id = generateOperationId();
  const now = new Date().toISOString();
  const record: OperationRecord = {
    operation_id: id,
    created_at: now,
    updated_at: now,
    status: "previewed",
    workspace_root: root,
    ...input,
  };
  mkdirSync(operationsDir(root, config), { recursive: true });
  writeAtomic(operationFile(id, root, config), JSON.stringify(record, null, 2));
  return record;
}

export function loadOperation(id: string, root: string, config: Config): OperationRecord {
  const file = operationFile(id, root, config);
  if (!existsSync(file)) {
    throw new AppError("OPERATION_NOT_FOUND", `Operation ${id} not found`, {
      details: { operation_id: id },
      recommendedAction: "re-run preview_move_lines",
    });
  }
  const record = JSON.parse(readFileSync(file, "utf8")) as OperationRecord;
  if (isExpired(record, config)) {
    return { ...record, status: "expired" };
  }
  return record;
}

export function operationFileExists(id: string, root: string, config: Config): boolean {
  return existsSync(operationFile(id, root, config));
}

function isExpired(record: OperationRecord, config: Config): boolean {
  const ageMs = Date.now() - new Date(record.created_at).getTime();
  return ageMs > config.operationTtlDays * 24 * 3600 * 1000;
}

const FORWARD_TRANSITIONS: Record<OperationStatus, OperationStatus[]> = {
  previewed: ["executed", "failed", "expired"],
  executed: ["undone", "failed"],
  undone: [],
  failed: [],
  expired: [],
};

export function updateOperation(
  id: string,
  expectedUpdatedAt: string,
  patch: Partial<OperationRecord>,
  root: string,
  config: Config,
): OperationRecord {
  const file = operationFile(id, root, config);
  if (!existsSync(file)) {
    throw new AppError("OPERATION_NOT_FOUND", `Operation ${id} not found`);
  }
  const current = JSON.parse(readFileSync(file, "utf8")) as OperationRecord;
  if (current.updated_at !== expectedUpdatedAt) {
    throw new AppError(
      "OPERATION_NOT_FOUND",
      `Operation ${id} has been modified concurrently; reload required`,
    );
  }
  if (patch.status && patch.status !== current.status) {
    const allowed = FORWARD_TRANSITIONS[current.status];
    if (!allowed.includes(patch.status)) {
      throw new AppError(
        "INTERNAL_ERROR",
        `Invalid status transition: ${current.status} -> ${patch.status}`,
      );
    }
  }
  const updated_at = new Date().toISOString();
  const next: OperationRecord = {
    ...current,
    ...patch,
    operation_id: current.operation_id,
    workspace_root: current.workspace_root,
    created_at: current.created_at,
    updated_at,
  };
  writeAtomic(file, JSON.stringify(next, null, 2));
  return next;
}

export function listOperations(root: string, config: Config): OperationRecord[] {
  const dir = operationsDir(root, config);
  if (!existsSync(dir)) return [];
  const records: OperationRecord[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const r = JSON.parse(readFileSync(join(dir, name), "utf8")) as OperationRecord;
      records.push(isExpired(r, config) ? { ...r, status: "expired" } : r);
    } catch {
      // skip malformed
    }
  }
  records.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return records;
}
