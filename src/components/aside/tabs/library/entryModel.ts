// What a library card shows, from a server entry or an older build's entry
// in this browser.

import type { ItemEntryV2 } from "@/api/types/media";
import { entryThumbs, shapeOfStored } from "@/lib/inputs/library";
import type { StoredEntry } from "@/lib/inputs/stored";
import type { EntryShape } from "@/lib/inputs/text";
import { entryMore, isNewerEntry, shapeOfItem } from "@/lib/media/entry";
import { readRecipeHead, type RecipeHead } from "@/lib/recipes/recipe";
import type { ThumbCell } from "./EntryThumbs";

/** A card's entry, whether the server keeps it or an older build here. */
export interface EntryModel {
  id: string;
  name: string;
  kind: EntryShape["kind"];
  pinned: boolean;
  shape: EntryShape;
  cells: ThumbCell[];
  more: number;
  /** On the server, or an older build's entry in this browser. */
  source: "server" | "legacy";
  /** A newer build saved it, and this build cannot read its frames. */
  newer: boolean;
  /** A recipe's models and preview; null for a frame or a set. */
  recipe: RecipeHead | null;
  /** A recipe saved without input pictures. */
  noInputs: boolean;
}

export function modelOfItem(item: ItemEntryV2): EntryModel {
  const shape = shapeOfItem(item);
  const recipe = shape.kind === "recipe" ? readRecipeHead(item.recipe) : null;
  const preview = recipe?.preview;
  const thumbs: ThumbCell[] = item.thumbs.map((t) => ({
    key: t.cid,
    kind: "server",
    hash: t.thumb,
    lost: t.lost,
  }));
  return {
    id: item.id,
    name: item.name,
    kind: shape.kind,
    pinned: item.pinned,
    shape,
    // a recipe's output first, then its inputs
    cells: preview
      ? [{ key: "preview", kind: "server", hash: preview.thumb, lost: preview.lost }, ...thumbs]
      : thumbs,
    more: entryMore(item),
    source: "server",
    newer: isNewerEntry(item) || (shape.kind === "recipe" && !recipe),
    recipe,
    noInputs: shape.kind === "recipe" && item.frames === 0,
  };
}

export function modelOfStored(entry: StoredEntry): EntryModel {
  const { pictures, more } = entryThumbs(entry);
  return {
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    pinned: entry.pinned,
    shape: shapeOfStored(entry),
    cells: pictures.map((picture) => ({ key: picture.id, kind: "local", picture })),
    more,
    source: "legacy",
    newer: false,
    recipe: null,
    noInputs: false,
  };
}
