import { existsSync, mkdirSync, readFileSync, copyFileSync } from "node:fs";
import { join, relative } from "node:path";
import { AppError } from "./errors.js";
import { writeAtomic } from "./files.js";
import { resolveInternalPath } from "./paths.js";
import type { Config } from "./config.js";

interface ManifestEntry {
  workspaceRelativePath: string;
  snapshotFile: string;
}

interface Manifest {
  entries: ManifestEntry[];
}

function snapshotDirFor(operationId: string, root: string, config: Config): string {
  return resolveInternalPath(join(config.snapshotDir, "snapshots", operationId), root);
}

function manifestPath(operationId: string, root: string, config: Config): string {
  return join(snapshotDirFor(operationId, root, config), "manifest.json");
}

function workspaceRelative(absPath: string, root: string): string {
  return relative(root, absPath).split("\\").join("/");
}

export function snapshot(
  operationId: string,
  absPaths: readonly string[],
  root: string,
  config: Config,
): void {
  for (const p of absPaths) {
    const rel = relative(root, p);
    if (rel.startsWith("..") || /^([a-zA-Z]:)?[\\/]/.test(rel)) {
      throw new AppError(
        "PATH_OUTSIDE_WORKSPACE",
        `Cannot snapshot path outside workspace: ${p}`,
      );
    }
  }
  const dir = snapshotDirFor(operationId, root, config);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    throw new AppError("SNAPSHOT_WRITE_FAILED", `Cannot create snapshot dir`, {
      details: { dir },
      cause: err,
    });
  }

  const entries: ManifestEntry[] = [];
  for (let i = 0; i < absPaths.length; i++) {
    const src = absPaths[i] as string;
    const snapFile = `${i}.bin`;
    try {
      copyFileSync(src, join(dir, snapFile));
    } catch (err) {
      throw new AppError("SNAPSHOT_WRITE_FAILED", `Cannot snapshot ${src}`, {
        details: { path: src },
        cause: err,
      });
    }
    entries.push({
      workspaceRelativePath: workspaceRelative(src, root),
      snapshotFile: snapFile,
    });
  }
  const manifest: Manifest = { entries };
  writeAtomic(manifestPath(operationId, root, config), JSON.stringify(manifest, null, 2));
}

export function snapshotExists(operationId: string, root: string, config: Config): boolean {
  return existsSync(manifestPath(operationId, root, config));
}

export function restore(operationId: string, root: string, config: Config): string[] {
  const mPath = manifestPath(operationId, root, config);
  if (!existsSync(mPath)) {
    throw new AppError("OPERATION_NOT_UNDOABLE", `Snapshot manifest missing for ${operationId}`, {
      details: { operation_id: operationId },
    });
  }
  const dir = snapshotDirFor(operationId, root, config);
  const manifest = JSON.parse(readFileSync(mPath, "utf8")) as Manifest;
  const restored: string[] = [];
  for (const entry of manifest.entries) {
    const target = resolveInternalPath(entry.workspaceRelativePath, root);
    const snapFile = join(dir, entry.snapshotFile);
    if (!existsSync(snapFile)) {
      throw new AppError("OPERATION_NOT_UNDOABLE", `Snapshot file missing: ${entry.snapshotFile}`, {
        details: { operation_id: operationId, file: entry.snapshotFile },
      });
    }
    const bytes = readFileSync(snapFile);
    writeAtomic(target, bytes, { mkdirs: true });
    restored.push(target);
  }
  return restored;
}
