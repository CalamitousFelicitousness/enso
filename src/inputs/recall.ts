// Saved and removed inputs back where they were: a library entry added after
// the inputs or put in their place, and what the trash keeps put back. Each
// reads before it writes: a wait, which lands as one step.

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
import { reasonText } from "@/lib/jobs/text";
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
import { fetchingText, inTrashText } from "@/lib/media/text";
import { useGenerationStore } from "@/stores/generationStore";
import { inputsReady } from "@/stores/inputStore";
import { announce, attach, command, wait } from "@/undo/marks";
import { readDocument } from "./db";
import { addFrames, putBack, restoreFrames } from "./edits";
import { bytesFor } from "./fetch";
import { entryCommand, movedText, nameOf, touchEntry, untrashEntry } from "./library";
import { currentMap, installMap, lookupMaps } from "./maps";
import { failureText } from "./quota";
import { loadRemoval, loadTrash, trashRecord, useTrash } from "./trash";

export type RecallMode = "add" | "replace";

const sizeNow = (): Size => {
  const { width, height } = useGenerationStore.getState();
  return { width, height };
};

const sameSize = (a: Size, b: Size) => a.width === b.width && a.height === b.height;

/** Make an entry's maps current again under the cid they are stored under,
 * unless the cache holds them already. */
export async function installEntryMaps(
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
 * the inputs going to the trash. Called in the landing. False when refused. */
function placeFrames(inputs: Inputs, name: string, mode: RecallMode): boolean {
  const clone = cloneFrames(inputs.frames, inputs.sizeSource, newId, "drop");
  if (mode === "add") {
    const now = sizeNow();
    const frames = sameSize(inputs.size, now)
      ? clone.frames
      : clone.frames.map((f) => refitFrame(f, now));
    return addFrames(frames);
  }
  restoreFrames({ frames: clone.frames, size: inputs.size, sizeSource: clone.sizeSource });
  announce("images").show(replacedWithText(name, inputs.size));
  return true;
}

/** A recall as it waits: a replace is cancelled by a newer change to the inputs. */
const recallWait = (name: string, mode: RecallMode) =>
  wait("images", { kind: "recall", args: { name, mode } }, { replaces: mode === "replace" });

/** Entries being recalled, so a second click while the first is read does nothing. */
const recalling = new Set<string>();

/** Recall a saved entry from the server. Pictures this browser lacks are
 * fetched by hash; while they come the notice says how far, and Cancel,
 * Undo or Ctrl+Z stop it before anything changed. False when nothing did. */
export async function recallEntry(id: string, mode: RecallMode): Promise<boolean> {
  if (recalling.has(id)) return false;
  recalling.add(id);
  const waited = recallWait(nameOf(id), mode);
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
    if (entry.inputs === null) {
      toast.info(reasonText("recipeNoInputs"));
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
        signal: waited.signal,
        onProgress: (p) => waited.progress(fetchingText(p.done, p.total, p.bytes)),
      });
    } catch (err) {
      if (!(err instanceof UserAbortError)) {
        toast.error(RECALL_FAILED, { description: failureText(err) });
      }
      return false;
    }
    if (waited.cancelled) return false;
    const { inputs, lost } = joinInputs(stored.inputs, fetched.blobs);
    await inputsReady();
    await installEntryMaps(entry.maps, fetched.blobs);
    let placed = false;
    if (!waited.land(() => (placed = placeFrames(inputs, entry.name, mode))) || !placed) {
      return false;
    }
    if (lost.pictures.length > 0) {
      toast.warning(lostEntryPicturesText(lost.pictures.length, entry.name));
    }
    touchEntry(id);
    return true;
  } finally {
    waited.end();
    recalling.delete(id);
  }
}

/** Recall an entry an older build kept in this browser, from its store. */
export async function recallLegacyEntry(id: string, mode: RecallMode): Promise<boolean> {
  if (recalling.has(id)) return false;
  recalling.add(id);
  const waited = recallWait(nameOf(id), mode);
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
      waited.end();
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
    let placed = false;
    if (!waited.land(() => (placed = placeFrames(entry.inputs, entry.name, mode))) || !placed) {
      return false;
    }
    if (lost.pictures.length > 0) {
      toast.warning(lostEntryPicturesText(lost.pictures.length, entry.name));
    }
    return true;
  } finally {
    waited.end();
    recalling.delete(id);
  }
}

/** Put back what a removal took out, from the trash, as one step; the record
 * goes once the inputs holding its content are stored, and an undo writes it
 * again before the content leaves. */
export async function restoreRemoval(key: string): Promise<boolean> {
  const stored = useTrash.getState().removals.get(key);
  // a replaced list taken back puts the list in its place
  const replaces = stored?.cause === "replaced" && stored.content.kind === "frames";
  const waited = wait("images", { kind: "from trash" }, { replaces });
  try {
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
    const { removal } = loaded;
    const record = trashRecord(removal, "before", Promise.resolve(key));
    const landed = waited.land(() => {
      putBack(removal);
      attach("images", record.command);
      announce("images").show(RESTORED_FROM_TRASH, {
        description: stored ? removalTitle(stored) : null,
      });
    });
    if (!landed) return false;
    void record.forget().then(() => loadTrash());
    const lost = loaded.lost.pictures.length;
    if (lost > 0) toast.warning(lostRestoredPicturesText(lost));
    return true;
  } finally {
    waited.end();
  }
}

/** Bring an entry back from the server's trash into the library, as the
 * most recently used, as a step of its own. */
export async function restoreEntry(id: string): Promise<boolean> {
  const back = await untrashEntry(id);
  if (!back) return false;
  const name = back.entry.name;
  command("shared", { kind: "entry restored", args: { name } }, entryCommand(id, "restored")).show(
    untrashedText(name),
    { description: movedText(back) },
  );
  return true;
}
