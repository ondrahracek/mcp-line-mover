import { loadOperation, operationFileExists, listOperations, type OperationRecord } from "./operations.js";
import { findMarkedRoot, type Workspace } from "./workspace.js";
import { listRegisteredRoots } from "./registry.js";
import { AppError } from "./errors.js";
import type { Config } from "./config.js";

export interface LocatedOperation {
  workspace: Workspace;
  record: OperationRecord;
}

export function locateOperation(opId: string, config: Config): LocatedOperation {
  if (config.fixedRoot !== null) {
    if (operationFileExists(opId, config.fixedRoot, config)) {
      return {
        workspace: { root: config.fixedRoot, inferred: false },
        record: loadOperation(opId, config.fixedRoot, config),
      };
    }
    throw notFound(opId);
  }

  const cwdRoot = findMarkedRoot(process.cwd(), config.rootMarkers, config.maxRootWalk);
  const candidates: { root: string; inferred: true }[] = [];
  if (cwdRoot && operationFileExists(opId, cwdRoot, config)) {
    candidates.push({ root: cwdRoot, inferred: true });
  }

  for (const r of listRegisteredRoots(config)) {
    if (cwdRoot && r === cwdRoot) continue;
    if (operationFileExists(opId, r, config)) {
      candidates.push({ root: r, inferred: true });
    }
  }

  if (candidates.length === 0) {
    throw notFound(opId);
  }
  if (candidates.length > 1) {
    throw new AppError(
      "OPERATION_NOT_FOUND",
      `Operation ${opId} matched multiple registered roots; registry may be corrupt`,
      {
        details: { matched_roots: candidates.map((c) => c.root) },
        recommendedAction: "set LINE_MOVER_ROOT to disambiguate or clean the registry",
      },
    );
  }
  const c = candidates[0]!;
  return {
    workspace: { root: c.root, inferred: c.inferred },
    record: loadOperation(opId, c.root, config),
  };
}

export function locateMostRecentExecutedOperation(config: Config): LocatedOperation {
  const roots: string[] = [];
  if (config.fixedRoot !== null) {
    roots.push(config.fixedRoot);
  } else {
    const cwdRoot = findMarkedRoot(process.cwd(), config.rootMarkers, config.maxRootWalk);
    if (cwdRoot) roots.push(cwdRoot);
    for (const r of listRegisteredRoots(config)) {
      if (!roots.includes(r)) roots.push(r);
    }
  }

  let best: { root: string; record: OperationRecord } | null = null;
  for (const root of roots) {
    const ops = listOperations(root, config).filter((o) => o.status === "executed");
    if (ops.length === 0) continue;
    const top = ops[0]!;
    if (!best || top.updated_at > best.record.updated_at) {
      best = { root, record: top };
    }
  }
  if (!best) {
    throw new AppError("OPERATION_NOT_FOUND", "No executed operation available to undo", {
      recommendedAction: "specify operation_id explicitly",
    });
  }
  return {
    workspace: { root: best.root, inferred: config.fixedRoot === null },
    record: best.record,
  };
}

function notFound(opId: string): AppError {
  return new AppError("OPERATION_NOT_FOUND", `Operation ${opId} not found`, {
    details: { operation_id: opId },
    recommendedAction: "re-run preview_move_lines",
  });
}
