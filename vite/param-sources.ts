import fs from "node:fs";
import path from "node:path";

// Single source for which files the palette codegen reads and which tab an
// entry belongs to. The Vite plugin and the codegen entry both import this,
// so the watcher and the generator can never disagree about scope.

export interface ParamSource {
  /** Repo-relative scan root. */
  root: string;
  /** Walk sub-directories. Off for roots whose sub-directories hold
   * components that are not tabs in their own right. */
  recursive: boolean;
  /** Filename suffix that marks an extractable file. */
  suffix: string;
}

export const PARAM_SOURCES: readonly ParamSource[] = [
  { root: "src/components/generation/tabs", recursive: false, suffix: "Tab.tsx" },
  { root: "src/components/video/forms", recursive: false, suffix: "Section.tsx" },
  { root: "src/components/video/forms/sections", recursive: false, suffix: "Section.tsx" },
  { root: "src/components/video/tabs", recursive: true, suffix: "Section.tsx" },
];

/** Whether a file is in scope, for the HMR watcher. */
export function isParamSourceFile(repoRoot: string, absPath: string): boolean {
  return PARAM_SOURCES.some((src) => {
    const root = path.resolve(repoRoot, src.root);
    if (!absPath.startsWith(root + path.sep)) return false;
    if (!absPath.endsWith(src.suffix)) return false;
    if (src.recursive) return true;
    return path.dirname(absPath) === root;
  });
}

function walk(dir: string, suffix: string, recursive: boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) out.push(...walk(full, suffix, true));
    } else if (entry.name.endsWith(suffix)) {
      out.push(full);
    }
  }
  return out.sort();
}

/** Every in-scope file, in a stable order. */
export function collectParamFiles(repoRoot: string): string[] {
  const files: string[] = [];
  for (const src of PARAM_SOURCES) {
    files.push(...walk(path.resolve(repoRoot, src.root), src.suffix, src.recursive));
  }
  return files;
}
