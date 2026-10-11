// Saved and removed inputs back where they were: a library entry added after
// the inputs or put in their place, and what the trash keeps put back.

import { toast } from "sonner";
import { api, ApiError } from "@/api/client";
import { queryClient } from "@/api/queryClient";
import { LIBRARY_KEY } from "@/api/queryKeys";
import type { ResEntryV2 } from "@/api/types/media";
import { newId } from "@/lib/id";
import { UserAbortError } from "@/lib/abort";
import { refitFrame } from "@/lib/inputs/geometry";
import { cloneFrames } from "@/lib/inputs/reducers";
import {
  joinEntry,
  joinInputs,
  readEntry,
  readStoredInputs,
  type Inputs,
  type ReadEntry,
} from "@/lib/inputs/stored";
import { LIBRARY } from "@/lib/inputs/storeLayout";
import {
  lostEntryPicturesText,
  lostRestoredPicturesText,
  NEWER_ENTRY,
  NO_LONGER_IN_LIBRARY,
  NO_LONGER_IN_TRASH,
  RECALL_FAILED,
  removalTitle,
  replacedWithText,
  RESTORED_FROM_TRASH,
  untrashedText,
} from "@/lib/inputs/text";
import type { Size } from "@/lib/inputs/types";
import { fetchingText, inTrashText, RESTORE_CANCELLED } from "@/lib/media/text";
import { useGenerationStore } from "@/stores/generationStore";
import { inputsReady } from "@/stores/inputStore";
import { readDocument } from "./db";
import { addFrames, offerInverse, putBack, restoreFrames } from "./edits";
import { bytesFor } from "./fetch";
import { movedText, moveToTrash, touchEntry, untrashEntry } from "./library";
import { currentMap, installMap, lookupMaps } from "./maps";
import { failureText } from "./quota";
import { forgetRemoval, loadRemoval, loadTrash, markRestoring, useTrash } from "./trash";
import { offerUndo, type UndoOffer } from "./undo";

export type RecallMode = "add" | "replace";

const sizeNow = (): Size => {
  const { width, height } = useGenerationStore.getState();
  return { width, height };
};

const sameSize = (a: Size, b: Size) => a.width === b.width && a.height === b.height;

/** Make an entry's maps current again under the cid they are stored under,
 * unless the cache holds them already. */
async function installEntryMaps(
  maps: Readonly<Record<string, string>>,
  blobs: ReadonlyMap<string, Blob>,
): Promise<void> {
  const keys = Object.keys(maps).filter((key) => !currentMap(key));
  if (keys.length === 0) return;
  await lookupMaps(keys);
  await Promise.all(
    keys.map(async (key) => {
      const cid = maps[key];
      const blob = cid ? blobs.get(cid) : undefined;
      if (cid && !currentMap(key) && blob) await installMap(key, blob, cid);
    }),
  );
}

/** Put recalled frames in: "add" after the inputs, refitted when the frame
 * size differs; "replace" in their place at the size they were saved at,
 * the inputs going to the trash. Both offer Undo. False when refused. */
function placeFrames(inputs: Inputs, name: string, mode: RecallMode): boolean {
  const clone = cloneFrames(inputs.frames, inputs.sizeSource, newId, "drop");
  if (mode === "add") {
    const now = sizeNow();
    const frames = sameSize(inputs.size, now)
      ? clone.frames
      : clone.frames.map((f) => refitFrame(f, now));
    return addFrames(frames);
  }
  const inverse = restoreFrames(
    { frames: clone.frames, size: inputs.size, sizeSource: clone.sizeSource },
    sizeNow(),
  );
  offerInverse(replacedWithText(name, inputs.size), null, inverse);
  return true;
}

/** Entries being recalled, so a second click while the first is read does nothing. */
const recalling = new Set<string>();

/** Recall a saved entry from the server. Pictures this browser lacks are
 * fetched by hash; while they come the notice says how far, and Cancel,
 * Undo or Ctrl+Z stop it before anything changed. False when nothing did. */
export async function recallEntry(id: string, mode: RecallMode): Promise<boolean> {
  if (recalling.has(id)) return false;
  recalling.add(id);
  // the notice of the fetch, once one starts
  const hold: { offer: UndoOffer | null } = { offer: null };
  const abort = new AbortController();
  try {
    let entry: ResEntryV2;
    try {
      entry = await api.get<ResEntryV2>(`/sdapi/v2/library/${encodeURIComponent(id)}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "gone") {
        toast.info(NO_LONGER_IN_LIBRARY);
        void queryClient.invalidateQueries({ queryKey: LIBRARY_KEY });
      } else {
        toast.error(RECALL_FAILED, { description: failureText(err) });
      }
      return false;
    }
    if (entry.trashed_at != null) {
      toast.info(inTrashText(entry.name));
      return false;
    }
    let stored: ReturnType<typeof readStoredInputs>;
    try {
      stored = readStoredInputs(entry.inputs);
    } catch {
      toast.info(NEWER_ENTRY);
      return false;
    }
    let fetched: Awaited<ReturnType<typeof bytesFor>>;
    try {
      fetched = await bytesFor([...stored.cids, ...Object.values(entry.maps)], entry.hashes, {
        signal: abort.signal,
        onProgress: (p) => {
          hold.offer ??= offerUndo(fetchingText(p.done, p.total, p.bytes), null, () => {
            abort.abort();
            toast.info(RESTORE_CANCELLED);
          });
          hold.offer.progress(fetchingText(p.done, p.total, p.bytes));
        },
      });
    } catch (err) {
      if (!(err instanceof UserAbortError)) {
        hold.offer?.withdraw();
        toast.error(RECALL_FAILED, { description: failureText(err) });
      }
      return false;
    }
    if (abort.signal.aborted) return false;
    const { inputs, lost } = joinInputs(stored.inputs, fetched.blobs);
    await inputsReady();
    await installEntryMaps(entry.maps, fetched.blobs);
    if (!placeFrames(inputs, entry.name, mode)) {
      hold.offer?.withdraw();
      return false;
    }
    if (lost.pictures.length > 0) {
      toast.warning(lostEntryPicturesText(lost.pictures.length, entry.name));
    }
    touchEntry(id);
    return true;
  } finally {
    recalling.delete(id);
  }
}

/** Recall an entry an older build kept in this browser, from its store. */
export async function recallLegacyEntry(id: string, mode: RecallMode): Promise<boolean> {
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
    if (!stored) {
      // another tab moved it to the server, where it keeps its id
      recalling.delete(id);
      return await recallEntry(id, mode);
    }
    if (stored.document.record.trashedAt !== null) {
      toast.info(NO_LONGER_IN_LIBRARY);
      return false;
    }
    const { entry, lost } = joinEntry(stored.document.record, stored.blobs);
    await inputsReady();
    await installEntryMaps(entry.maps, stored.blobs);
    if (!placeFrames(entry.inputs, entry.name, mode)) return false;
    if (lost.pictures.length > 0) {
      toast.warning(lostEntryPicturesText(lost.pictures.length, entry.name));
    }
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

/** Bring an entry back from the server's trash into the library, as the
 * most recently used, with Undo. */
export async function restoreEntry(id: string): Promise<boolean> {
  const back = await untrashEntry(id);
  if (!back) return false;
  offerUndo(untrashedText(back.entry.name), movedText(back), () => moveToTrash(id));
  return true;
}
