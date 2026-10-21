// A recipe in the shape of a job's record, so Run is the replay a record
// already has: the recipe's request, upload sources and map keys over the
// entry's frames, maps and hashes.

import type { RecordLoad } from "@/inputs/jobs";
import { RECORD_SCHEMA, type StoredInputs } from "@/lib/inputs/stored";
import { refsIn, UPLOAD_PREFIX } from "@/lib/jobs/replay";
import type { Recipe } from "./recipe";

/** What the library keeps beside a recipe part. */
export interface RecipeEntry {
  id: string;
  savedAt: number;
  inputs: StoredInputs | null;
  maps: Readonly<Record<string, string>>;
  hashes: Readonly<Record<string, string>>;
  /** Cids whose bytes the server lost or never got. */
  lost: readonly string[];
  unavailable: readonly string[];
}

/** The hashes of the uploads the recipe's request names. */
export function requestHashes(recipe: Pick<Recipe, "request">): string[] {
  return refsIn(recipe.request).map((ref) => ref.slice(UPLOAD_PREFIX.length));
}

/** The record load of a recipe, `absent` holding the request hashes a claim
 * says the server does not hold. */
export function recipeLoad(
  entry: RecipeEntry,
  recipe: Recipe,
  absent: ReadonlySet<string>,
): RecordLoad {
  return {
    record: {
      schema: RECORD_SCHEMA,
      id: entry.id,
      domain: "generate",
      createdAt: entry.savedAt,
      checkpoint: recipe.checkpoint
        ? { title: recipe.checkpoint.title, name: recipe.checkpoint.name }
        : null,
      request: recipe.request,
      refs: recipe.refs,
      inputs: entry.inputs,
      mapKeys: [...recipe.map_keys],
      maps: { ...entry.maps },
      routed: true,
    },
    hashes: entry.hashes,
    missingRefs: refsIn(recipe.request).filter((ref) =>
      absent.has(ref.slice(UPLOAD_PREFIX.length)),
    ),
    unheld: new Set([...entry.lost, ...entry.unavailable]),
    legacy: false,
  };
}
