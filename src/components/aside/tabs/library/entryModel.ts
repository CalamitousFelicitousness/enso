// What a library card shows, from a server entry or an older build's entry
// in this browser.

import type { ItemEntryV2 } from "@/api/types/media";
import { entryThumbs, shapeOfStored } from "@/lib/inputs/library";
import type { StoredEntry } from "@/lib/inputs/stored";
import type { EntryShape } from "@/lib/inputs/text";
import { entryMore, isNewerEntry, shapeOfItem } from "@/lib/media/entry";
import type { ThumbCell } from "./EntryThumbs";

/** A card's entry, whether the server keeps it or an older build here. */
export interface EntryModel {
  id: string;
  name: string;
  kind: "frame" | "set";
  pinned: boolean;
  shape: EntryShape;
  cells: ThumbCell[];
  more: number;
  /** On the server, or an older build's entry in this browser. */
  source: "server" | "legacy";
  /** A newer build saved it, and this build cannot read its frames. */
  newer: boolean;
}

export function modelOfItem(item: ItemEntryV2): EntryModel {
  return {
    id: item.id,
    name: item.name,
    kind: item.kind === "set" ? "set" : "frame",
    pinned: item.pinned,
    shape: shapeOfItem(item),
    cells: item.thumbs.map((t) => ({ key: t.cid, kind: "server", hash: t.thumb, lost: t.lost })),
    more: entryMore(item),
    source: "server",
    newer: isNewerEntry(item),
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
  };
}
