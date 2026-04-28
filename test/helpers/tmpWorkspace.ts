import { mkdtempSync, rmSync, realpathSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadConfig, type Config, type Env } from "../../src/core/config.js";
import type { Workspace } from "../../src/core/workspace.js";

export interface TmpWorkspace {
  root: string;
  config: Config;
  workspace: Workspace;
  registryDir: string;
  write(relPath: string, content: string | Buffer): string;
  read(relPath: string): Buffer;
  cleanup(): void;
  withEnv(env: Env): Config;
}

export function makeTmpWorkspace(env: Env = {}): TmpWorkspace {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lm-ws-")));
  const registryDir = realpathSync(mkdtempSync(join(tmpdir(), "lm-reg-")));
  const config = loadConfig(
    { ...env, LINE_MOVER_ROOT: root, LINE_MOVER_REGISTRY_DIR: registryDir },
    root,
  );
  const workspace: Workspace = Object.freeze({ root, inferred: false });
  return {
    root,
    config,
    workspace,
    registryDir,
    write(relPath, content) {
      const abs = join(root, relPath);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
      return abs;
    },
    read(relPath) {
      return readFileSync(join(root, relPath));
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true, maxRetries: 3 });
      rmSync(registryDir, { recursive: true, force: true, maxRetries: 3 });
    },
    withEnv(extra: Env) {
      return loadConfig(
        { ...env, ...extra, LINE_MOVER_ROOT: root, LINE_MOVER_REGISTRY_DIR: registryDir },
        root,
      );
    },
  };
}

export function isCaseSensitiveFs(): boolean {
  const dir = mkdtempSync(join(tmpdir(), "lm-cs-"));
  try {
    writeFileSync(join(dir, "Aa"), "x");
    try {
      const buf = readFileSync(join(dir, "aA"));
      return buf.toString() !== "x";
    } catch {
      return true;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
