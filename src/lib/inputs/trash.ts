// What the trash lists: removals the inputs lost here, entries the server's
// library let go, and entries an older build's library let go here while
// they wait to be moved, as one kind of item, each with when it goes.

import type { ItemEntryV2 } from "@/api/types/media";
import { shapeOfItem } from "@/lib/media/entry";
import { entryThumbs, shapeOfStored } from "./library";
import { removalExpiry } from "./sweep";
import type { StoredEntry, StoredPicture, StoredRemoval } from "./stored";
import { entryTrashTitle, removalTitle } from "./text";

const DAY = 24 * 60 * 60 * 1000;

/** Where an item lives: a removal here, an entry on the server, an older
 * build's entry here, or a Gallery file in the server's trash. */
export type TrashSource = "removal" | "entry" | "legacy" | "file";

/** A picture to show for an item: one this browser stores, or a thumbnail
 * the server holds by hash. */
export type TrashThumb =
  { kind: "local"; picture: StoredPicture } | { kind: "server"; hash: string; lost: boolean };

export interface TrashItem {
  /** Unique in the list: the source and the record's key. */
  id: string;
  source: TrashSource;
  /** The record's key where it lives. */
  key: string;
  title: string;
  /** A saved entry's own name, which the title quotes; null for a removal. */
  name: string | null;
  thumb: TrashThumb | null;
  removedAt: number;
  /** When it goes for good: at the first page start after this for what is
   * stored here, at the server's next pass after this for its entries. */
  expiresAt: number;
  /** Who removed it, when the server knows. */
  by: string | null;
  /** Removed by hand, or pushed out of the library by a save. */
  cause: "removed" | "evicted";
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

const local = (picture: StoredPicture | null | undefined): TrashThumb | null =>
  picture ? { kind: "local", picture } : null;

export function removalItem(key: string, removal: StoredRemoval, removalMs: number): TrashItem {
  return {
    id: `removal:${key}`,
    source: "removal",
    key,
    title: removalTitle(removal),
    name: null,
    thumb: local(firstPicture(removal)),
    removedAt: removal.removedAt,
    expiresAt: removalExpiry(removal.removedAt, removalMs),
    by: null,
    cause: "removed",
  };
}

/** An older build's trashed entry, which goes with this browser's removals. */
export function legacyEntryItem(
  entry: StoredEntry & { trashedAt: number },
  removalMs: number,
): TrashItem {
  return {
    id: `legacy:${entry.id}`,
    source: "legacy",
    key: entry.id,
    title: entryTrashTitle(entry.name, shapeOfStored(entry)),
    name: entry.name,
    thumb: local(entryThumbs(entry).pictures[0]),
    removedAt: entry.trashedAt,
    expiresAt: removalExpiry(entry.trashedAt, removalMs),
    by: null,
    cause: "removed",
  };
}

/** A trashed entry on the server; `days` dates its expiry when the server sends none. */
export function serverEntryItem(
  item: ItemEntryV2 & { trashed_at: number },
  days: number,
): TrashItem {
  const thumb = item.thumbs[0];
  return {
    id: `entry:${item.id}`,
    source: "entry",
    key: item.id,
    title: entryTrashTitle(item.name, shapeOfItem(item)),
    name: item.name,
    thumb: thumb ? { kind: "server", hash: thumb.thumb, lost: thumb.lost } : null,
    removedAt: item.trashed_at,
    // the server counts a restarted collection clock; an older one sends none
    expiresAt: item.expires_at ?? item.trashed_at + days * DAY,
    by: item.trashed_by ?? null,
    cause: item.trashed_cause === "evicted" ? "evicted" : "removed",
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

/** How many of the server's trashed items, their clocks started at `startedAt`,
 * a retention of `days` lets go. */
export function goingOnServer(startedAt: readonly number[], days: number, now: number): number {
  return startedAt.filter((at) => at + days * DAY <= now).length;
}

/** When the server's clock for a trashed item started: its expiry, counted
 * with `days`, taken back by them; its removal when no expiry was sent. */
export function clockStart(
  expiresAt: number | null | undefined,
  trashedAt: number,
  days: number,
): number {
  return expiresAt == null ? trashedAt : expiresAt - days * DAY;
}
