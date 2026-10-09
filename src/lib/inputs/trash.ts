// What the trash lists: removals the inputs lost and entries the library let
// go, as one kind of item, each with when it goes for good.

import { entryThumbs } from "./library";
import { removalExpiry } from "./sweep";
import type { StoredEntry, StoredPicture, StoredRemoval } from "./stored";
import { entryTrashTitle, removalTitle } from "./text";

export interface TrashItem {
  /** Unique in the list: the store and the record's key. */
  id: string;
  source: "removal" | "entry";
  /** The record's key in its store. */
  key: string;
  title: string;
  /** A picture to show for it, when it has one. */
  thumb: StoredPicture | null;
  removedAt: number;
  /** When it goes for good, at the first page start after this. */
  expiresAt: number;
}

function firstPicture(removal: StoredRemoval): StoredPicture | null {
  const { content } = removal;
  switch (content.kind) {
    case "picture":
      return content.picture;
    case "frames":
      return content.frames.flatMap((f) => f.pictures)[0] ?? null;
    default:
      return content.frame.pictures[0] ?? null;
  }
}

export function removalItem(key: string, removal: StoredRemoval, removalMs: number): TrashItem {
  return {
    id: `removal:${key}`,
    source: "removal",
    key,
    title: removalTitle(removal),
    thumb: firstPicture(removal),
    removedAt: removal.removedAt,
    expiresAt: removalExpiry(removal.removedAt, removalMs),
  };
}

export function entryItem(
  entry: StoredEntry & { trashedAt: number },
  removalMs: number,
): TrashItem {
  return {
    id: `entry:${entry.id}`,
    source: "entry",
    key: entry.id,
    title: entryTrashTitle(entry),
    thumb: entryThumbs(entry).pictures[0] ?? null,
    removedAt: entry.trashedAt,
    expiresAt: removalExpiry(entry.trashedAt, removalMs),
  };
}

/** Newest first. */
export function byRemoval(a: TrashItem, b: TrashItem): number {
  return b.removedAt - a.removedAt || a.id.localeCompare(b.id);
}

/** How many items would go at the next page start if the trash kept them `removalMs`. */
export function goingWith(
  items: readonly Pick<TrashItem, "removedAt">[],
  removalMs: number,
  now: number,
): number {
  return items.filter((item) => removalExpiry(item.removedAt, removalMs) <= now).length;
}
