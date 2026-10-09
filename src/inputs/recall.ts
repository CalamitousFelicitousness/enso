// Saved and removed inputs back where they were: a library entry added after
// the inputs or put in their place, and what the trash keeps put back.

import { toast } from "sonner";
import { useGenerationStore } from "@/stores/generationStore";
import { inputsReady } from "@/stores/inputStore";
import { refitFrame } from "@/lib/inputs/geometry";
import { cloneFrames } from "@/lib/inputs/reducers";
import { joinEntry, readEntry, type ReadEntry } from "@/lib/inputs/stored";
import { LIBRARY } from "@/lib/inputs/storeLayout";
import {
  evictedText,
  lostEntryPicturesText,
  lostRestoredPicturesText,
  NO_LONGER_IN_LIBRARY,
  NO_LONGER_IN_TRASH,
  PINS_FULL_ON_RESTORE,
  RECALL_FAILED,
  removalTitle,
  replacedWithText,
  RESTORED_FROM_TRASH,
  untrashedText,
} from "@/lib/inputs/text";
import type { Size } from "@/lib/inputs/types";
import { readDocument } from "./db";
import { addFrames, offerInverse, putBack, restoreFrames } from "./edits";
import { loadLibrary, moveToTrash, touchEntry, untrashEntry } from "./library";
import { forgetRemoval, loadRemoval, loadTrash, markRestoring, useTrash } from "./trash";
import { offerUndo } from "./undo";
import { currentMap, installMap, lookupMaps } from "./maps";
import { failureText } from "./quota";

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
      toast.error(RECALL_FAILED, { description: failureText(err) });
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
      const inverse = restoreFrames(
        { frames: clone.frames, size: entry.inputs.size, sizeSource: clone.sizeSource },
        sizeNow(),
      );
      offerInverse(replacedWithText(entry.name, entry.inputs.size), null, inverse);
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

/** Put back what a removal took out, from the trash, with Undo; the record
 * goes once the offer settles without it. */
export async function restoreRemoval(key: string): Promise<boolean> {
  const stored = useTrash.getState().removals.get(key);
  let loaded: Awaited<ReturnType<typeof loadRemoval>>;
  try {
    loaded = await loadRemoval(key);
  } catch (err) {
    console.error("[inputs] could not read a removal record", err);
    toast.error(RECALL_FAILED, { description: failureText(err) });
    return false;
  }
  if (!loaded) {
    toast.info(NO_LONGER_IN_TRASH);
    void loadTrash();
    return false;
  }
  await inputsReady();
  const id = `removal:${key}`;
  markRestoring(id, true);
  const inverse = putBack(loaded.removal);
  offerInverse(
    RESTORED_FROM_TRASH,
    stored ? removalTitle(stored) : null,
    {
      frames: inverse.frames,
      run: () => {
        inverse.run();
        markRestoring(id, false);
      },
    },
    () => {
      void forgetRemoval(key).then(() => {
        markRestoring(id, false);
        return loadTrash();
      });
    },
  );
  const lost = loaded.lost.pictures.length;
  if (lost > 0) toast.warning(lostRestoredPicturesText(lost));
  return true;
}

/** Bring an entry back from the trash into the library, as the most recently
 * used, with Undo. */
export async function restoreEntry(id: string): Promise<boolean> {
  let back: Awaited<ReturnType<typeof untrashEntry>>;
  try {
    back = await untrashEntry(id, true);
  } catch (err) {
    console.error("[inputs] could not bring an entry back", err);
    toast.error(RECALL_FAILED, { description: failureText(err) });
    return false;
  }
  if (!back) {
    toast.info(NO_LONGER_IN_TRASH);
    void loadLibrary();
    return false;
  }
  const notes = [
    back.unpinned ? PINS_FULL_ON_RESTORE : null,
    back.pushedOut.length > 0
      ? evictedText(
          back.pushedOut.map((e) => e.name),
          useTrash.getState().days,
        )
      : null,
  ].filter((note): note is string => note !== null);
  offerUndo(untrashedText(back.entry.name), notes.join(". ") || null, async () => {
    await moveToTrash(id);
  });
  return true;
}
