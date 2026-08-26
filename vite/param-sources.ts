import fs from "node:fs";
import path from "node:path";

// Single source for which files the palette codegen reads and which tab an
// entry belongs to. The Vite plugin and the codegen entry both import this,
// so the watcher and the generator can never disagree about scope.

export type ParamView = "images" | "video";

export interface ParamSource {
  view: ParamView;
  /** Repo-relative scan root, walked recursively. */
  root: string;
}

export const PARAM_SOURCES: readonly ParamSource[] = [
  { view: "images", root: "src/components/generation/tabs" },
  { view: "video", root: "src/components/video/tabs" },
];

export interface Attribution {
  view: ParamView;
  tab: string;
}

/**
 * Which tab a file's params belong to.
 *
 * Directly in a root: the filename carries it (`SamplerTab.tsx` -> sampler).
 * In a sub-directory: the first segment carries it, so a sub-tab directory is
 * its own map and cannot drift from one. Anything else in scope is an error -
 * silently dropping a file is how entries used to vanish unnoticed.
 */
export function classifyFile(repoRoot: string, absPath: string): Attribution | null {
  if (!absPath.endsWith(".tsx")) return null;
  for (const src of PARAM_SOURCES) {
    const root = path.resolve(repoRoot, src.root);
    if (!absPath.startsWith(root + path.sep)) continue;
    const rel = path.relative(root, absPath);
    const segments = rel.split(path.sep);
    if (segments.length > 1) return { view: src.view, tab: segments[0].toLowerCase() };
    const base = path.basename(absPath, ".tsx");
    if (base.endsWith("Tab")) return { view: src.view, tab: base.slice(0, -3).toLowerCase() };
    throw new Error(
      `[paramMap codegen] ${path.relative(repoRoot, absPath)} sits in a scan root but names no tab. ` +
        `Name it <Tab>Tab.tsx or move it into the sub-tab directory it belongs to.`,
    );
  }
  return null;
}

/** Whether a file is in scope, for the HMR watcher. */
export function isParamSourceFile(repoRoot: string, absPath: string): boolean {
  if (!absPath.endsWith(".tsx")) return false;
  return PARAM_SOURCES.some((src) =>
    absPath.startsWith(path.resolve(repoRoot, src.root) + path.sep),
  );
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out.sort();
}

/** Every in-scope file with its attribution, in a stable order. */
export function collectParamFiles(repoRoot: string): { file: string; attribution: Attribution }[] {
  const out: { file: string; attribution: Attribution }[] = [];
  for (const src of PARAM_SOURCES) {
    for (const file of walk(path.resolve(repoRoot, src.root))) {
      const attribution = classifyFile(repoRoot, file);
      if (attribution) out.push({ file, attribution });
    }
  }
  return out;
}
