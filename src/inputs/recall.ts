// Saved inputs back into the document: a library entry added after the
// inputs or put in their place.

import { toast } from "sonner";
import { useGenerationStore } from "@/stores/generationStore";
import { inputsReady } from "@/stores/inputStore";
import { refitFrame } from "@/lib/inputs/geometry";
import { cloneFrames } from "@/lib/inputs/reducers";
import { joinEntry, readEntry, type ReadEntry } from "@/lib/inputs/stored";
import { LIBRARY } from "@/lib/inputs/storeLayout";
import {
  lostEntryPicturesText,
  NO_LONGER_IN_LIBRARY,
  RECALL_FAILED,
  replacedWithText,
} from "@/lib/inputs/text";
import type { Size } from "@/lib/inputs/types";
import { readDocument } from "./db";
import { addFrames, restoreFrames } from "./edits";
import { loadLibrary, touchEntry } from "./library";
import { currentMap, installMap, lookupMaps } from "./maps";
import { offerUndo } from "./undo";

export type RecallMode = "add" | "replace";

const sizeNow = (): Size => {
  const { width, height } = useGenerationStore.getState();
  return { width, height };
};

const sameSize = (a: Size, b: Size) => a.width === b.width && a.height === b.height;

/** Make an entry's maps current again under the cid they are stored under,
 * unless the cache holds them already. */
async function installEntryMaps(
  maps: Record<string, string>,
  blobs: ReadonlyMap<string, Blob>,
): Promise<void> {
  const keys = Object.keys(maps).filter((key) => !currentMap(key));
  if (keys.length === 0) return;
  await lookupMaps(keys);
  await Promise.all(
    keys.map(async (key) => {
      const blob = blobs.get(maps[key]);
      if (!currentMap(key) && blob) await installMap(key, blob, maps[key]);
    }),
  );
}

/** Entries being recalled, so a second click while the first is read does nothing. */
const recalling = new Set<string>();

/** Recall a library entry: "add" puts its frames after the inputs (or in the
 * place of a blank list), refitted when the frame size differs; "replace"
 * puts them in the inputs' place at the size they were saved at, the inputs
 * going to the trash. Both offer Undo. False when nothing changed. */
export async function recallEntry(id: string, mode: RecallMode): Promise<boolean> {
  if (recalling.has(id)) return false;
  recalling.add(id);
  try {
    let stored: { document: ReadEntry; blobs: Map<string, Blob> } | null;
    try {
      stored = await readDocument(LIBRARY, id, readEntry, (read) => read.cids);
    } catch (err) {
      console.error("[inputs] could not read a library entry", err);
      toast.error(RECALL_FAILED, { description: err instanceof Error ? err.message : String(err) });
      return false;
    }
    if (!stored || stored.document.record.trashedAt !== null) {
      toast.info(NO_LONGER_IN_LIBRARY);
      void loadLibrary();
      return false;
    }
    const { entry, lost } = joinEntry(stored.document.record, stored.blobs);
    await inputsReady();
    await installEntryMaps(entry.maps, stored.blobs);
    const clone = cloneFrames(
      entry.inputs.frames,
      entry.inputs.sizeSource,
      () => crypto.randomUUID(),
      "drop",
    );
    if (mode === "add") {
      const now = sizeNow();
      const frames = sameSize(entry.inputs.size, now)
        ? clone.frames
        : clone.frames.map((f) => refitFrame(f, now));
      if (!addFrames(frames)) return false;
    } else {
      const undo = restoreFrames(
        { frames: clone.frames, size: entry.inputs.size, sizeSource: clone.sizeSource },
        sizeNow(),
      );
      offerUndo(replacedWithText(entry.name, entry.inputs.size), null, undo);
    }
    if (lost.pictures.length > 0) {
      toast.warning(lostEntryPicturesText(lost.pictures.length, entry.name));
    }
    void touchEntry(id);
    return true;
  } finally {
    recalling.delete(id);
  }
}
