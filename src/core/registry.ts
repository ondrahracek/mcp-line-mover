import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./files.js";
import { ensureRegistryDir } from "./config.js";
import type { Config } from "./config.js";

const REGISTRY_FILE = "roots.log";
const MAX_ENTRIES = 1000;

function registryFilePath(config: Config): string {
  return join(config.registryDir, REGISTRY_FILE);
}

export function registerRoot(root: string, config: Config): void {
  if (!root) return;
  try {
    ensureRegistryDir(config);
    const file = registryFilePath(config);
    const existing = readEntries(file);
    if (existing.includes(root)) return;
    let next = [...existing, root];
    if (next.length > MAX_ENTRIES) next = next.slice(next.length - MAX_ENTRIES);
    writeAtomic(file, next.join("\n") + "\n");
  } catch {
    // best-effort; registry is an index, not a security boundary
  }
}

export function listRegisteredRoots(config: Config): string[] {
  try {
    const file = registryFilePath(config);
    const entries = readEntries(file);
    const live: string[] = [];
    let dirty = false;
    for (const e of entries) {
      if (dirExists(e)) {
        if (!live.includes(e)) live.push(e);
      } else {
        dirty = true;
      }
    }
    if (dirty && live.length !== entries.length) {
      try {
        writeAtomic(file, live.length === 0 ? "" : live.join("\n") + "\n");
      } catch {
        // best-effort prune
      }
    }
    return live;
  } catch {
    return [];
  }
}

function readEntries(file: string): string[] {
  if (!existsSync(file)) return [];
  try {
    const content = readFileSync(file, "utf8");
    return content
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

function dirExists(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export { registryFilePath as _registryFilePathForTest };
