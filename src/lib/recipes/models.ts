// How a recipe's models stand on this server, computed from the model lists
// whenever they are read; never stored, since the lists change under it.

import type { ModelId, NetworkId, Recipe } from "./recipe";

/** installed: the same file is here. otherFile: a file of that name is here and
 * both digests are known and differ. unchecked: a file of that name is here but
 * a digest is missing on one side. missing: nothing of that name. */
export type ModelState = "installed" | "otherFile" | "unchecked" | "missing";

/** A checkpoint as /sd-models lists it. */
export interface LocalCheckpoint {
  title: string;
  model_name: string;
  filename: string;
  hash?: string | null | undefined;
  /** The file's SHA-256, or a diffusers model's snapshot id. */
  sha256?: string | null | undefined;
}

/** A LoRA as /extra-networks lists it. */
export interface LocalNetwork {
  name: string;
  filename?: string | null | undefined;
  sha256?: string | null | undefined;
}

/** A file this browser downloaded to stand for a digest, before sdnext has hashed it. */
export interface Download {
  sha256: string;
  filename: string;
}

const DIGEST = /^[0-9a-f]{64}$/;

const isDigest = (value: string | null | undefined): value is string =>
  typeof value === "string" && DIGEST.test(value);

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function downloaded(
  sha256: string | null,
  filename: string | null | undefined,
  downloads: readonly Download[],
): boolean {
  if (!sha256 || !filename) return false;
  const name = basename(filename);
  return downloads.some((d) => d.sha256 === sha256 && basename(d.filename) === name);
}

export function checkpointState<T extends LocalCheckpoint>(
  id: ModelId,
  installed: readonly T[],
  downloads: readonly Download[] = [],
): { state: ModelState; match: T | null } {
  const same = installed.find(
    (m) =>
      (isDigest(id.sha256) && m.sha256 === id.sha256) ||
      (id.shorthash !== null && m.hash === id.shorthash) ||
      (id.snapshot !== null && m.sha256 === id.snapshot) ||
      downloaded(id.sha256, m.filename, downloads),
  );
  if (same) return { state: "installed", match: same };
  const named = installed.find((m) => m.model_name === id.name);
  if (!named) return { state: "missing", match: null };
  return {
    state: isDigest(id.sha256) && isDigest(named.sha256) ? "otherFile" : "unchecked",
    match: named,
  };
}

/** A LoRA by its file's digest only: sdnext's short hash for a LoRA may be an
 * addnet hash or one the file's metadata claims, not a prefix of the digest. */
export function networkState<T extends LocalNetwork>(
  id: NetworkId,
  installed: readonly T[],
  downloads: readonly Download[] = [],
): { state: ModelState; match: T | null } {
  const same = installed.find(
    (n) =>
      (isDigest(id.sha256) && n.sha256 === id.sha256) ||
      downloaded(id.sha256, n.filename, downloads),
  );
  if (same) return { state: "installed", match: same };
  const named = installed.find((n) => n.name === id.name);
  if (!named) return { state: "missing", match: null };
  return {
    state: isDigest(id.sha256) && isDigest(named.sha256) ? "otherFile" : "unchecked",
    match: named,
  };
}

export interface RecipeStates {
  checkpoint: { state: ModelState; match: LocalCheckpoint | null } | null;
  networks: { id: NetworkId; state: ModelState }[];
  /** Networks neither installed nor named here. */
  missingNetworks: number;
}

export function recipeStates(
  recipe: Pick<Recipe, "checkpoint" | "networks">,
  checkpoints: readonly LocalCheckpoint[],
  networks: readonly LocalNetwork[],
  downloads: readonly Download[] = [],
): RecipeStates {
  const states = recipe.networks.map((id) => ({
    id,
    state: networkState(id, networks, downloads).state,
  }));
  return {
    checkpoint: recipe.checkpoint
      ? checkpointState(recipe.checkpoint, checkpoints, downloads)
      : null,
    networks: states,
    missingNetworks: states.filter((n) => n.state === "missing").length,
  };
}

const TITLE_HASH = /\[([0-9a-f]{10})\]$/;

/** A record's checkpoint as a model id: sdnext's title carries the short hash. */
export function recordedModel(checkpoint: { title: string; name: string }): ModelId {
  return {
    title: checkpoint.title,
    name: checkpoint.name,
    path: "",
    sha256: null,
    shorthash: TITLE_HASH.exec(checkpoint.title)?.[1] ?? null,
    snapshot: null,
    class_name: null,
    type: null,
  };
}
