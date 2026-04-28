import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { AppError } from "./errors.js";
import type { Config } from "./config.js";

export interface Workspace {
  readonly root: string;
  readonly inferred: boolean;
}

export function findMarkedRoot(
  startPath: string,
  markers: readonly string[],
  maxWalk: number,
): string | null {
  let current = nearestExisting(isAbsolute(startPath) ? startPath : resolve(startPath));
  for (let depth = 0; depth <= maxWalk; depth++) {
    if (hasAnyMarker(current, markers)) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

function hasAnyMarker(dir: string, markers: readonly string[]): boolean {
  for (const m of markers) {
    if (existsSync(resolve(dir, m))) return true;
  }
  return false;
}

function nearestExisting(p: string): string {
  let current = p;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  try {
    return realpathSync(current);
  } catch {
    return current;
  }
}

export function resolveWorkspaceForPaths(absPaths: string[], config: Config): Workspace {
  if (config.fixedRoot !== null) {
    return Object.freeze({ root: config.fixedRoot, inferred: false });
  }
  if (absPaths.length === 0) {
    throw new AppError(
      "PATH_OUTSIDE_WORKSPACE",
      "Cannot infer workspace root: no input paths supplied",
    );
  }
  const inferredRoots = new Set<string>();
  const home = realpathSafe(homedir());
  for (const p of absPaths) {
    const root = findMarkedRoot(p, config.rootMarkers, config.maxRootWalk);
    if (root === null) {
      throw new AppError(
        "PATH_OUTSIDE_WORKSPACE",
        `No workspace marker found for ${p}`,
        {
          details: { path: p, markers: [...config.rootMarkers] },
          recommendedAction: `set LINE_MOVER_ROOT, or operate inside a directory containing one of: ${config.rootMarkers.join(", ")}`,
        },
      );
    }
    if (realpathSafe(root) === home) {
      throw new AppError(
        "PATH_OUTSIDE_WORKSPACE",
        `Refusing to use home directory as workspace root`,
        {
          details: { path: p, root },
          recommendedAction: "set LINE_MOVER_ROOT explicitly to override",
        },
      );
    }
    inferredRoots.add(realpathSafe(root));
  }
  if (inferredRoots.size > 1) {
    throw new AppError(
      "PATH_OUTSIDE_WORKSPACE",
      `Inputs resolve to multiple workspace roots; cross-workspace operations are not supported`,
      {
        details: { inferred_roots: Array.from(inferredRoots) },
        recommendedAction: "ensure source and dest are in the same repository",
      },
    );
  }
  const [root] = inferredRoots;
  return Object.freeze({ root: root as string, inferred: true });
}

export function resolveWorkspaceForRoot(rootPath: string): Workspace {
  return Object.freeze({ root: realpathSafe(rootPath), inferred: false });
}

function realpathSafe(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}
