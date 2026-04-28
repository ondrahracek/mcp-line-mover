import { realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve, sep, normalize, relative } from "node:path";
import { AppError } from "./errors.js";
import type { Config } from "./config.js";

export function resolveUserPath(input: string, root: string, config: Config): string {
  const resolved = resolveSafe(input, root);
  if (isPathDenied(relative(root, resolved), config.denyGlobs)) {
    throw new AppError("PATH_DENIED", `Path is denied by policy: ${input}`, {
      details: { path: input },
      recommendedAction: "use a different path or adjust LINE_MOVER_DENY_GLOBS",
    });
  }
  return resolved;
}

export function resolveInternalPath(input: string, root: string): string {
  return resolveSafe(input, root);
}

function resolveSafe(input: string, root: string): string {
  const candidate = isAbsolute(input) ? normalize(input) : resolve(root, input);
  const resolved = realpathDeep(candidate);

  const rel = relative(root, resolved);
  const escapes = rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel);
  if (escapes) {
    throw new AppError(
      "PATH_OUTSIDE_WORKSPACE",
      `Path resolves outside workspace root: ${input}`,
      {
        details: { path: input, root },
        recommendedAction: "use a path inside the configured workspace root",
      },
    );
  }
  return resolved;
}

function realpathDeep(p: string): string {
  let current = p;
  const tail: string[] = [];
  while (true) {
    try {
      const real = realpathSync(current);
      return tail.length === 0 ? real : resolve(real, ...tail.reverse());
    } catch {
      const parent = resolve(current, "..");
      if (parent === current) return resolve(current, ...tail.reverse());
      const seg = current.slice(parent.length).replace(/^[\\/]/, "");
      tail.push(seg);
      current = parent;
    }
  }
}

export function isPathDenied(relPath: string, denyGlobs: readonly string[]): boolean {
  const normalized = relPath.split(sep).join("/");
  for (const glob of denyGlobs) {
    if (matchesGlob(normalized, glob)) return true;
  }
  return false;
}

export function matchesGlob(path: string, glob: string): boolean {
  const re = globToRegExp(glob);
  return re.test(path);
}

function globToRegExp(glob: string): RegExp {
  let re = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const followsSlash = re.endsWith("/") || re.length === 0;
        const nextIsSlash = glob[i + 2] === "/";
        if (followsSlash && nextIsSlash) {
          re += "(?:.*/)?";
          i += 3;
          continue;
        }
        re += ".*";
        i += 2;
        continue;
      }
      re += "[^/]*";
      i++;
      continue;
    }
    if (c === "?") {
      re += "[^/]";
      i++;
      continue;
    }
    if (c && /[.+^${}()|[\]\\]/.test(c)) {
      re += "\\" + c;
      i++;
      continue;
    }
    re += c;
    i++;
  }
  return new RegExp("^" + re + "$");
}

export function pathsAreSame(a: string, b: string): boolean {
  try {
    const sa = statSync(a);
    const sb = statSync(b);
    if (sa.dev === sb.dev && sa.ino === sb.ino && sa.ino !== 0) return true;
  } catch {
    // fall through to path comparison
  }
  const ra = safeRealpath(a);
  const rb = safeRealpath(b);
  if (ra === rb) return true;
  if (isCaseInsensitiveFs()) return ra.toLowerCase() === rb.toLowerCase();
  return false;
}

let caseInsensitiveCache: boolean | undefined;
function isCaseInsensitiveFs(): boolean {
  if (caseInsensitiveCache !== undefined) return caseInsensitiveCache;
  caseInsensitiveCache = process.platform === "win32" || process.platform === "darwin";
  return caseInsensitiveCache;
}

function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    const parent = resolve(p, "..");
    try {
      const realParent = realpathSync(parent);
      const tail = p.slice(parent.length).replace(/^[\\/]/, "");
      return resolve(realParent, tail);
    } catch {
      return resolve(p);
    }
  }
}
