// A saved entry as the server keeps it: the body a save posts, what a card
// shows of one, and the name a user gives it.

import type { ItemEntryV2, ReqEntryV2 } from "@/api/types/media";
import { DOCUMENT_SCHEMA, type EntryKind, type StoredInputs } from "@/lib/inputs/stored";
import { roleLabelOf, type EntryShape } from "@/lib/inputs/text";

/** The longest name the server keeps, in characters. */
export const NAME_MAX = 200;

/** A name as the server takes it: trimmed, at most NAME_MAX characters. */
export function clampName(name: string): string {
  return [...name.trim()].slice(0, NAME_MAX).join("");
}

/** What the server lists of an entry without reading its frames. */
export function entrySummary(kind: EntryKind, inputs: StoredInputs): ReqEntryV2["summary"] {
  const first = inputs.frames[0];
  const frame = kind === "frame" && first ? first : null;
  return {
    frames: inputs.frames.length,
    pictures: inputs.frames.reduce((n, f) => n + f.pictures.length, 0),
    role: frame ? frame.role : null,
    control: frame?.role === "control" ? frame.control.type : null,
    width: inputs.size.width,
    height: inputs.size.height,
    inputs_schema: inputs.schema,
  };
}

/** The thumbnail of one of an entry's pictures, by the hash of its bytes. */
export interface ThumbPart {
  cid: string;
  /** The hash of the thumbnail's bytes on the server. */
  thumb: string;
  width: number;
  height: number;
}

export interface EntryParts {
  id: string;
  kind: EntryKind;
  name: string;
  inputs: StoredInputs;
  /** Every cid the inputs name. */
  inputCids: readonly string[];
  /** The cid of each current map saved with the entry, by key. */
  maps: Readonly<Record<string, string>>;
  /** The hash on the server of each cid's bytes; a cid without one did not get there. */
  hashes: ReadonlyMap<string, string>;
  thumbs: readonly ThumbPart[];
  /** What an older build stored, carried as it was when the entry moves to the server. */
  moved?: { savedAt: number; usedAt: number; pinned: boolean; trashedAt: number | null };
}

/** The body of a save: a picture whose bytes did not get there is declared
 * unavailable, a map is left out, and a thumbnail goes only beside its picture. */
export function assembleEntry(parts: EntryParts): ReqEntryV2 {
  const hashes: Record<string, string> = {};
  const unavailable: string[] = [];
  for (const cid of new Set(parts.inputCids)) {
    const hash = parts.hashes.get(cid);
    if (hash) hashes[cid] = hash;
    else unavailable.push(cid);
  }
  const maps: Record<string, string> = {};
  for (const [key, cid] of Object.entries(parts.maps)) {
    const hash = parts.hashes.get(cid);
    if (!hash) continue;
    maps[key] = cid;
    hashes[cid] = hash;
  }
  const thumbs = parts.thumbs.flatMap((t) => {
    const hash = hashes[t.cid];
    return hash ? [{ cid: t.cid, hash, thumb: t.thumb, width: t.width, height: t.height }] : [];
  });
  return {
    id: parts.id,
    kind: parts.kind,
    name: clampName(parts.name),
    summary: entrySummary(parts.kind, parts.inputs),
    inputs: structuredClone(parts.inputs) as unknown as Record<string, unknown>,
    maps,
    hashes,
    unavailable,
    thumbs,
    ...(parts.moved
      ? {
          migrating: true,
          saved_at: parts.moved.savedAt,
          used_at: parts.moved.usedAt,
          pinned: parts.moved.pinned,
          trashed_at: parts.moved.trashedAt,
        }
      : {}),
  };
}

/** How many of an entry's pictures its card does not show: a frame's past
 * the thumbnails, a set's frames past four. */
export function entryMore(
  item: Pick<ItemEntryV2, "kind" | "frames" | "pictures" | "thumbs">,
): number {
  return item.kind === "set"
    ? Math.max(0, item.frames - 4)
    : Math.max(0, item.pictures - item.thumbs.length);
}

/** An entry a newer build saved, whose frames this build cannot read. */
export function isNewerEntry(item: Pick<ItemEntryV2, "inputs_schema">): boolean {
  return item.inputs_schema > DOCUMENT_SCHEMA;
}

/** What a server entry holds, as its card and the trash say it. */
export function shapeOfItem(
  item: Pick<ItemEntryV2, "kind" | "frames" | "pictures" | "role" | "control" | "width" | "height">,
): EntryShape {
  const kind = item.kind === "set" ? "set" : "frame";
  return {
    kind,
    frames: item.frames,
    pictures: item.pictures,
    roleLabel: kind === "frame" && item.role ? roleLabelOf(item.role, item.control ?? null) : null,
    size: { width: item.width, height: item.height },
  };
}

/** The library's order: pinned first, then the most recently used, the later
 * saved first when used at the same time, so the next to leave is last. */
export function byLibraryOrder(
  a: Pick<ItemEntryV2, "id" | "pinned" | "used_at" | "saved_at">,
  b: Pick<ItemEntryV2, "id" | "pinned" | "used_at" | "saved_at">,
): number {
  return (
    Number(b.pinned) - Number(a.pinned) ||
    b.used_at - a.used_at ||
    b.saved_at - a.saved_at ||
    a.id.localeCompare(b.id)
  );
}
