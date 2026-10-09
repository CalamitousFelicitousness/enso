// The library: frames and sets saved in the library store of enso-inputs.
// An entry names its pictures and maps by cid like any document, so it adds
// no bytes of its own. The cap and the pins are applied inside the write,
// from what the store holds then, so two tabs cannot both overrun them.

import { toast } from "sonner";
import { create } from "zustand";
import { inputsReady, useInputStore } from "@/stores/inputStore";
import { useGenerationStore } from "@/stores/generationStore";
import { defaultEntryName, MAX_PINNED_ENTRIES, overCap, pinned } from "@/lib/inputs/library";
import { outlineEntry, type OutlineEnv } from "@/lib/inputs/outline";
import {
  readEntry,
  splitEntry,
  type Entry,
  type EntryKind,
  type StoredEntry,
} from "@/lib/inputs/stored";
import { LIBRARY } from "@/lib/inputs/storeLayout";
import { RETENTION_MS } from "@/lib/inputs/sweep";
import {
  entryTrashedText,
  evictedText,
  linkedSaveText,
  NOTHING_TO_SAVE,
  pinLimitText,
  SAVE_FAILED,
  savedText,
} from "@/lib/inputs/text";
import { holdsContent, type Frame } from "@/lib/inputs/types";
import { readAllRecords, rewriteStore, updateRecord } from "./db";
import { currentMapsOf } from "./maps";
import { outlineOf } from "./outlineOf";
import { offerUndo } from "./undo";

export interface LibraryState {
  /** Every entry this build can read, in the library or in the trash, by id. */
  entries: ReadonlyMap<string, StoredEntry>;
  /** Keys of the records this build cannot read. */
  unreadable: readonly string[];
  /** The store has been read once. */
  loaded: boolean;
}

export const useLibrary = create<LibraryState>()(() => ({
  entries: new Map(),
  unreadable: [],
  loaded: false,
}));

/** Records this tab changed, into what it shows. */
function show(changed: readonly StoredEntry[]): void {
  if (changed.length === 0) return;
  useLibrary.setState((s) => {
    const entries = new Map(s.entries);
    for (const entry of changed) entries.set(entry.id, entry);
    return { entries };
  });
}

/** The trash keeps what goes to it this many days. */
export function retentionDays(): number {
  return Math.round(RETENTION_MS / (24 * 60 * 60 * 1000));
}

let reading: Promise<void> | null = null;

/** Read the library again: once the page-start sweep has run, and whenever
 * another tab may have changed it. */
export function loadLibrary(): Promise<void> {
  reading ??= (async () => {
    await inputsReady();
    try {
      const entries = new Map<string, StoredEntry>();
      const unreadable: string[] = [];
      for (const [key, value] of await readAllRecords(LIBRARY)) {
        // entries are stored under their id
        if (typeof key !== "string") continue;
        try {
          const { record } = readEntry(value);
          entries.set(record.id, record);
        } catch (err) {
          console.warn("[inputs] a library entry could not be read", key, err);
          unreadable.push(key);
        }
      }
      useLibrary.setState({ entries, unreadable, loaded: true });
    } catch (err) {
      console.error("[inputs] could not read the library", err);
    }
  })().finally(() => {
    reading = null;
  });
  return reading;
}

/** The readable entries among a store's records, by key. */
function readable(records: ReadonlyMap<string, unknown>): Map<string, StoredEntry> {
  const entries = new Map<string, StoredEntry>();
  for (const [key, value] of records) {
    try {
      entries.set(key, readEntry(value).record);
    } catch {
      // a record this build cannot read is neither counted nor touched
    }
  }
  return entries;
}

/** Entries past the cap, sent to the trash in the same write. */
function evicted(entries: ReadonlyMap<string, StoredEntry>, now: number): StoredEntry[] {
  return overCap(entries.values()).flatMap((id) => {
    const entry = entries.get(id);
    return entry ? [{ ...entry, trashedAt: now }] : [];
  });
}

const NO_BLOBS: ReadonlyMap<string, Blob> = new Map();

/** Store a new entry and tell it, with what it pushed out of the library. */
async function storeEntry(
  entry: Entry,
  maps: ReadonlyMap<string, Blob>,
): Promise<StoredEntry | null> {
  const { record, blobs } = splitEntry(entry);
  for (const [cid, blob] of maps) blobs.set(cid, blob);
  let pushedOut: StoredEntry[];
  try {
    // a record this build could not read back would stop every sweep
    readEntry(record);
    pushedOut =
      (await rewriteStore(LIBRARY, (records) => {
        const entries = readable(records);
        entries.set(record.id, record);
        const gone = evicted(entries, entry.savedAt);
        const put = new Map<string, StoredEntry>([[record.id, record]]);
        for (const e of gone) put.set(e.id, e);
        return { put, blobs, result: gone };
      })) ?? [];
  } catch (err) {
    console.error("[inputs] could not save to the library", err);
    toast.error(SAVE_FAILED, { description: err instanceof Error ? err.message : String(err) });
    return null;
  }
  show([record, ...pushedOut]);
  toast.success(savedText(record.name), {
    description:
      pushedOut.length > 0
        ? evictedText(
            pushedOut.map((e) => e.name),
            retentionDays(),
          )
        : undefined,
  });
  return record;
}

/** Why these frames cannot be saved, or null. A Control frame that uses
 * another frame's picture holds none of its own. */
function saveRefusal(frames: Frame[], all: Frame[]): string | null {
  if (frames.length === 1 && frames[0].link) {
    const outline = outlineOf(all);
    const position = outlineEntry(outline, frames[0].id)?.position ?? 0;
    const source = outlineEntry(outline, frames[0].link.frameId)?.position;
    if (source !== undefined) return linkedSaveText(position, source);
  }
  return frames.some(holdsContent) ? null : NOTHING_TO_SAVE;
}

/** Save frames of the inputs: one frame as a frame entry, the whole list as a
 * set, with the maps current for them and the frame size their placements
 * are in. Null when nothing was saved; the user has been told why. */
export async function saveFrames(
  env: OutlineEnv,
  frameIds: readonly string[] | "all",
): Promise<StoredEntry | null> {
  await inputsReady();
  const doc = useInputStore.getState();
  const frames =
    frameIds === "all" ? doc.frames : doc.frames.filter((f) => frameIds.includes(f.id));
  const refusal = saveRefusal(frames, doc.frames);
  if (refusal) {
    toast.info(refusal);
    return null;
  }
  const kind: EntryKind = frameIds === "all" || frames.length > 1 ? "set" : "frame";
  const maps = await currentMapsOf(frames, env);
  const { width, height } = useGenerationStore.getState();
  const pick = doc.sizeSource;
  const now = Date.now();
  const position = outlineEntry(outlineOf(doc.frames), frames[0].id)?.position ?? 1;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return storeEntry(
    {
      id: crypto.randomUUID(),
      kind,
      name: defaultEntryName(kind, frames[0], position, now, timeZone),
      savedAt: now,
      usedAt: now,
      pinned: false,
      trashedAt: null,
      inputs: {
        frames,
        size: { width, height },
        sizeSource: pick && frames.some((f) => f.id === pick.frameId) ? pick : null,
      },
      maps: Object.fromEntries(maps.map((m) => [m.key, m.cid])),
    },
    new Map(maps.map((m) => [m.cid, m.blob])),
  );
}

/** Change one entry where it is stored, and show the change. Null when the
 * entry is gone or `change` leaves it as it is. */
async function changeEntry(
  id: string,
  change: (entry: StoredEntry) => StoredEntry | null,
): Promise<StoredEntry | null> {
  const changed: StoredEntry[] = [];
  await updateRecord(LIBRARY, id, (raw) => {
    const next = change(readEntry(raw).record);
    if (!next) return null;
    // checked like a new record before it replaces a readable one
    const { record } = readEntry(next);
    changed.push(record);
    return record;
  });
  show(changed);
  return changed[0] ?? null;
}

export function renameEntry(id: string, name: string): Promise<StoredEntry | null> {
  const trimmed = name.trim();
  return changeEntry(id, (e) => (trimmed && trimmed !== e.name ? { ...e, name: trimmed } : null));
}

/** The entry was recalled: it is the most recently used. */
export function touchEntry(id: string): Promise<StoredEntry | null> {
  return changeEntry(id, (e) => (e.trashedAt === null ? { ...e, usedAt: Date.now() } : null));
}

/** Pin or unpin an entry. A pin past the limit is refused and said so;
 * unpinning pushes nothing out until the next save. */
export async function setPinned(id: string, pin: boolean): Promise<boolean> {
  let refused = false;
  try {
    const changed = await rewriteStore(LIBRARY, (records) => {
      const entries = readable(records);
      const entry = entries.get(id);
      if (!entry || entry.trashedAt !== null || entry.pinned === pin) return null;
      if (pin && pinned(entries.values()).length >= MAX_PINNED_ENTRIES) {
        refused = true;
        return null;
      }
      const next = { ...entry, pinned: pin };
      return { put: new Map([[id, next]]), blobs: NO_BLOBS, result: next };
    });
    if (changed) show([changed]);
  } catch (err) {
    console.error("[inputs] could not pin a library entry", err);
    return false;
  }
  if (refused) toast.info(pinLimitText(MAX_PINNED_ENTRIES));
  return !refused;
}

/** Bring an entry back from the trash into the library: as the most recently
 * used when `touch`, unpinned when the pins are full, pushing out what the
 * cap then asks for. */
export async function untrashEntry(
  id: string,
  touch: boolean,
): Promise<{ entry: StoredEntry; unpinned: boolean; pushedOut: StoredEntry[] } | null> {
  const now = Date.now();
  return rewriteStore(LIBRARY, (records) => {
    const entries = readable(records);
    const entry = entries.get(id);
    if (!entry || entry.trashedAt === null) return null;
    const pinsFull = entry.pinned && pinned(entries.values()).length >= MAX_PINNED_ENTRIES;
    const back: StoredEntry = {
      ...entry,
      trashedAt: null,
      pinned: entry.pinned && !pinsFull,
      usedAt: touch ? now : entry.usedAt,
    };
    entries.set(id, back);
    const gone = evicted(entries, now).filter((e) => e.id !== id);
    const put = new Map<string, StoredEntry>([[id, back]]);
    for (const e of gone) put.set(e.id, e);
    return { put, blobs: NO_BLOBS, result: { entry: back, unpinned: pinsFull, pushedOut: gone } };
  }).then((outcome) => {
    if (outcome) show([outcome.entry, ...outcome.pushedOut]);
    return outcome;
  });
}

/** Move an entry to the trash, with Undo. */
export async function trashEntry(id: string): Promise<void> {
  let trashed: StoredEntry | null;
  try {
    trashed = await changeEntry(id, (e) =>
      e.trashedAt === null ? { ...e, trashedAt: Date.now() } : null,
    );
  } catch (err) {
    console.error("[inputs] could not move a library entry to the trash", err);
    return;
  }
  if (!trashed) return;
  offerUndo(entryTrashedText(trashed.name), null, async () => {
    await untrashEntry(id, false);
  });
}
