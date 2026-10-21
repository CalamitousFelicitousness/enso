// The library on the server: frames and sets saved for every browser of the
// server, their pictures stored once by hash. A save uploads what the server
// lacks through one batch and posts the entry; every other change is one
// request whose answer is put into the lists the page holds, and the
// server's events bring the changes other browsers make.

import { toast } from "sonner";
import { create } from "zustand";
import { api, ApiError } from "@/api/client";
import { queryClient } from "@/api/queryClient";
import { entryKey, LIBRARY_KEY, storeOffIn, TRASH_KEY } from "@/api/queryKeys";
import type {
  ItemEntryV2,
  ReqEntryPatchV2,
  ResEntryChangeV2,
  ResFreedV2,
  ResLibraryV2,
  ResTrashV2,
} from "@/api/types/media";
import type { LibrarySubTab } from "@/lib/constants";
import { newId } from "@/lib/id";
import { defaultEntryName, entryThumbs, MAX_PINNED_ENTRIES } from "@/lib/inputs/library";
import { outlineEntry, type OutlineEnv } from "@/lib/inputs/outline";
import { readStoredInputs, storedInputsOf, type EntryKind, type Inputs } from "@/lib/inputs/stored";
import {
  EMPTY_SERVER_TRASH_FAILED,
  entryChangeFailedText,
  entryDeletedText,
  entryTrashedText,
  evictedText,
  linkedSaveText,
  NO_LONGER_IN_LIBRARY,
  NO_LONGER_IN_TRASH,
  NOTHING_TO_SAVE,
  pinLimitText,
  SAVE_FAILED,
  savedText,
  SHOW_IN_LIBRARY,
} from "@/lib/inputs/text";
import { holdsContent, type Frame } from "@/lib/inputs/types";
import { assembleEntry, byLibraryOrder, clampName, type ThumbPart } from "@/lib/media/entry";
import { isGone, type Outcome } from "@/lib/media/stage";
import { batchText, serverFreedText, unpinnedText } from "@/lib/media/text";
import { useGenerationStore } from "@/stores/generationStore";
import { inputsReady, useInputStore } from "@/stores/inputStore";
import { useUiStore } from "@/stores/uiStore";
import { currentMapsOf } from "./maps";
import { outlineOf } from "./outlineOf";
import { missingHashes } from "./submit";
import { thumbBlob } from "./thumbs";
import { offerUndo } from "./undo";
import { UploadBatch } from "./uploads";

/** Saves under way, so their entry points read busy. */
export const useLibrarySaving = create<{ saving: number }>()(() => ({ saving: 0 }));

/** Open the Library on one of its lists. */
export function showLibrary(list: LibrarySubTab = "saved"): void {
  useUiStore.getState().openRightSubTab({ rightTab: "library", subTab: list });
}

/** The card the Saved list reveals and focuses once it renders it. */
export const useLibraryReveal = create<{ id: string | null }>()(() => ({ id: null }));

/** Open the Library's Saved list, its search cleared, on one entry's card. */
export function showEntry(id: string): void {
  useLibraryReveal.setState({ id });
  showLibrary("saved");
}

/** How long the trash keeps what goes to it, as the server last said. */
function trashDays(): number {
  return (
    queryClient.getQueryData<ResLibraryV2>(LIBRARY_KEY)?.days ??
    queryClient.getQueryData<ResTrashV2>(TRASH_KEY)?.days ??
    7
  );
}

function maxPins(): number {
  return queryClient.getQueryData<ResLibraryV2>(LIBRARY_KEY)?.pins.max ?? MAX_PINNED_ENTRIES;
}

function nameOf(id: string): string {
  const listed = [
    ...(queryClient.getQueryData<ResLibraryV2>(LIBRARY_KEY)?.entries ?? []),
    ...(queryClient.getQueryData<ResTrashV2>(TRASH_KEY)?.entries ?? []),
  ];
  return listed.find((e) => e.id === id)?.name ?? id;
}

/** Put the server's answer about an entry into the lists the page holds;
 * the entries it pushed out are read again with the trash. */
export function applyEntry(entry: ItemEntryV2, pushedOut: readonly string[] = []): void {
  const gone = new Set(pushedOut);
  queryClient.setQueryData<ResLibraryV2>(LIBRARY_KEY, (old) => {
    if (!old) return old;
    const entries = old.entries.filter((e) => e.id !== entry.id && !gone.has(e.id));
    if (entry.trashed_at == null) entries.push(entry);
    entries.sort(byLibraryOrder);
    return {
      ...old,
      entries,
      pins: { ...old.pins, count: entries.filter((e) => e.pinned).length },
    };
  });
  queryClient.setQueryData<ResTrashV2>(TRASH_KEY, (old) => {
    if (!old) return old;
    const entries = old.entries.filter((e) => e.id !== entry.id);
    if (entry.trashed_at != null) entries.unshift(entry);
    return { ...old, entries };
  });
  if (gone.size > 0) void queryClient.invalidateQueries({ queryKey: TRASH_KEY });
  void queryClient.invalidateQueries({ queryKey: entryKey(entry.id) });
}

/** What a change moved besides its own entry: entries the cap pushed out,
 * and the pin the full pins took back. */
export function movedText(change: ResEntryChangeV2): string | null {
  const notes: string[] = [];
  if (change.pushed_out.length > 0) {
    notes.push(
      evictedText(
        change.pushed_out.map((p) => p.name),
        trashDays(),
      ),
    );
  }
  if (change.unpinned) notes.push(unpinnedText(maxPins()));
  return notes.length > 0 ? notes.join(". ") : null;
}

/** A change the server refused or that failed, said: an entry gone from the
 * server, or out of the trash a delete needs it in, reads the lists again. */
export function refused(err: unknown, failedTitle: string, goneText = NO_LONGER_IN_LIBRARY): void {
  const code = err instanceof ApiError ? err.code : null;
  if (code === "gone" || code === "not_trashed") {
    toast.info(goneText);
    void queryClient.invalidateQueries({ queryKey: LIBRARY_KEY });
    return;
  }
  if (code === "pins_full") {
    toast.info(pinLimitText(maxPins()));
    return;
  }
  const detail = err instanceof ApiError ? err.detail : null;
  const description =
    storeOffIn(err) ?? detail?.message ?? (err instanceof Error ? err.message : String(err));
  toast.error(failedTitle, { description });
}

async function patch(id: string, change: ReqEntryPatchV2): Promise<ResEntryChangeV2> {
  const answer = await api.patch<ResEntryChangeV2>(
    `/sdapi/v2/library/${encodeURIComponent(id)}`,
    change,
  );
  applyEntry(
    answer.entry,
    answer.pushed_out.map((p) => p.id),
  );
  return answer;
}

export async function renameEntry(id: string, name: string): Promise<boolean> {
  const clamped = clampName(name);
  if (clamped === nameOf(id)) return false;
  try {
    await patch(id, { name: clamped });
    return true;
  } catch (err) {
    refused(err, entryChangeFailedText("rename", nameOf(id)));
    return false;
  }
}

/** Pins being changed: a second click waits for the first to land. */
const pinning = new Set<string>();

/** Pin or unpin an entry; the card shows it at once. Unpinning can push the
 * least recently used entry out of a full library, which is said. */
export async function setPinned(id: string, pin: boolean): Promise<boolean> {
  if (pinning.has(id)) return false;
  pinning.add(id);
  const before = queryClient.getQueryData<ResLibraryV2>(LIBRARY_KEY);
  queryClient.setQueryData<ResLibraryV2>(LIBRARY_KEY, (old) =>
    old
      ? {
          ...old,
          entries: old.entries
            .map((e) => (e.id === id ? { ...e, pinned: pin } : e))
            .sort(byLibraryOrder),
        }
      : old,
  );
  try {
    const moved = movedText(await patch(id, { pinned: pin }));
    if (moved) toast.info(moved);
    return true;
  } catch (err) {
    if (before) queryClient.setQueryData(LIBRARY_KEY, before);
    refused(err, entryChangeFailedText(pin ? "pin" : "unpin", nameOf(id)));
    return false;
  } finally {
    pinning.delete(id);
  }
}

/** The entry was recalled: it is the most recently used. */
export function touchEntry(id: string): void {
  patch(id, { used: true }).catch((err: unknown) => {
    console.warn("[library] could not mark an entry used", err);
  });
}

/** Bring an entry back from the trash: it is the most recently used, the cap
 * applies and full pins leave it unpinned. Null when that was refused, said. */
export async function untrashEntry(id: string): Promise<ResEntryChangeV2 | null> {
  try {
    return await patch(id, { trashed: false });
  } catch (err) {
    refused(err, entryChangeFailedText("trash", nameOf(id)), NO_LONGER_IN_TRASH);
    return null;
  }
}

/** Move an entry back to the trash, as the Undo of bringing it out. */
export async function moveToTrash(id: string): Promise<void> {
  try {
    await patch(id, { trashed: true });
  } catch (err) {
    refused(err, entryChangeFailedText("trash", nameOf(id)));
  }
}

/** Move an entry to the trash, with Undo. */
export async function trashEntry(id: string): Promise<void> {
  const name = nameOf(id);
  try {
    await patch(id, { trashed: true });
  } catch (err) {
    refused(err, entryChangeFailedText("trash", name));
    return;
  }
  offerUndo(entryTrashedText(name), null, async () => {
    const back = await untrashEntry(id);
    const moved = back && movedText(back);
    if (moved) toast.info(moved);
  });
}

function dropFromTrash(ids: readonly string[]): void {
  const gone = new Set(ids);
  queryClient.setQueryData<ResTrashV2>(TRASH_KEY, (old) =>
    old ? { ...old, entries: old.entries.filter((e) => !gone.has(e.id)) } : old,
  );
}

/** Delete a trashed entry for everyone, freeing what only it named. */
export async function deleteEntry(id: string): Promise<boolean> {
  const name = nameOf(id);
  try {
    const answer = await api.delete<ResFreedV2>(`/sdapi/v2/library/${encodeURIComponent(id)}`);
    dropFromTrash([id]);
    toast(entryDeletedText(name), { description: serverFreedText(answer.freed, null) });
    return true;
  } catch (err) {
    void queryClient.invalidateQueries({ queryKey: LIBRARY_KEY });
    refused(err, entryChangeFailedText("delete", name), NO_LONGER_IN_TRASH);
    return false;
  }
}

/** The most ids one Empty request may name. */
const EMPTY_CHUNK = 1000;

/** Delete the listed trashed entries for everyone; what another client
 * trashed since the list was read stays. Null when it failed, said. */
export async function emptyServerTrash(
  ids: readonly string[],
): Promise<{ deleted: number; freed: number } | null> {
  let deleted = 0;
  let freed = 0;
  try {
    for (let start = 0; start < ids.length; start += EMPTY_CHUNK) {
      const chunk = ids.slice(start, start + EMPTY_CHUNK);
      const answer = await api.post<ResFreedV2>("/sdapi/v2/library/trash/empty", { ids: chunk });
      dropFromTrash(answer.deleted);
      deleted += answer.deleted.length;
      freed += answer.freed;
    }
    return { deleted, freed };
  } catch (err) {
    void queryClient.invalidateQueries({ queryKey: LIBRARY_KEY });
    refused(err, EMPTY_SERVER_TRASH_FAILED);
    return deleted > 0 ? { deleted, freed } : null;
  }
}

/** A name for a new set, from when it is saved. */
function setName(now: number, frames: Frame[]): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return defaultEntryName("set", frames[0], 1, now, timeZone);
}

interface SaveParts {
  kind: EntryKind;
  name: string;
  inputs: Inputs;
  /** The current maps of the pictures, saved with them. */
  maps: readonly { key: string; cid: string; blob: Blob }[];
}

/** The hash of each cid's bytes the batch sent or found held. */
function hashesOf(
  refs: ReadonlyMap<string, string>,
  outcomes: ReadonlyMap<string, Outcome>,
): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const [cid, ref] of refs) {
    const outcome = outcomes.get(ref);
    if (outcome && !isGone(outcome)) hashes.set(cid, outcome.hash);
  }
  return hashes;
}

/** Upload what the server lacks of an entry and post it: every picture,
 * mask object, region mask and map by cid, and the cards' thumbnails. A
 * server that lost bytes since the claim gets them again once. */
async function storeEntry(parts: SaveParts): Promise<ItemEntryV2 | null> {
  const stored = storedInputsOf(parts.inputs);
  const { cids } = readStoredInputs(stored);
  const id = newId();
  const toastId = `library-save-${id}`;
  useLibrarySaving.setState((s) => ({ saving: s.saving + 1 }));
  try {
    const batch = new UploadBatch("Save to library", {
      onProgress: (p) => {
        if (p.phase !== "claiming" && p.files > 0) {
          toast.loading(batchText(p.done, p.files, p.sent, p.total), { id: toastId });
        }
      },
    });
    const refs = new Map<string, string>();
    const files = new Map<string, Blob>();
    const stage = (bytes: Blob | null, cid: string, name: string) => {
      if (bytes) files.set(cid, bytes);
      refs.set(cid, batch.stage(bytes, { name, cid }).ref);
    };
    for (const frame of parts.inputs.frames) {
      for (const p of frame.pictures) stage(p.file, p.cid, p.name);
      for (const o of frame.mask.objects) stage(o.blob, o.cid, o.name);
      for (const m of frame.ipAdapter.masks) stage(m.file, m.cid, m.name);
    }
    for (const map of parts.maps) stage(map.blob, map.cid, "map.png");
    const thumbRefs = new Map<string, { ref: string; width: number; height: number }>();
    for (const picture of entryThumbs({ kind: parts.kind, inputs: stored }).pictures) {
      const file = files.get(picture.cid);
      if (!file) continue;
      const thumb = await thumbBlob({
        cid: picture.cid,
        file,
        width: picture.width,
        height: picture.height,
      }).catch(() => null);
      if (!thumb) continue;
      const { ref } = batch.stage(thumb, { name: `${picture.name}.webp` });
      thumbRefs.set(picture.cid, { ref, width: picture.width, height: picture.height });
    }

    let outcomes = await batch.run();
    const body = () => {
      const hashes = hashesOf(refs, outcomes);
      const thumbs: ThumbPart[] = [];
      for (const [cid, t] of thumbRefs) {
        const outcome = outcomes.get(t.ref);
        if (outcome && !isGone(outcome)) {
          thumbs.push({ cid, thumb: outcome.hash, width: t.width, height: t.height });
        }
      }
      return assembleEntry({
        id,
        kind: parts.kind,
        name: parts.name,
        inputs: stored,
        inputCids: cids,
        maps: Object.fromEntries(parts.maps.map((m) => [m.key, m.cid])),
        hashes,
        thumbs,
      });
    };
    let answer: ResEntryChangeV2;
    try {
      answer = await api.post<ResEntryChangeV2>("/sdapi/v2/library", body());
    } catch (err) {
      const misses = missingHashes(err);
      if (!misses) throw err;
      outcomes = new Map([...outcomes, ...(await batch.again({}, misses).run())]);
      answer = await api.post<ResEntryChangeV2>("/sdapi/v2/library", body());
    }
    applyEntry(
      answer.entry,
      answer.pushed_out.map((p) => p.id),
    );
    toast.success(savedText(answer.entry.name), {
      id: toastId,
      description: movedText(answer) ?? undefined,
      action: { label: SHOW_IN_LIBRARY, onClick: () => showLibrary() },
    });
    return answer.entry;
  } catch (err) {
    console.error("[library] could not save", err);
    toast.dismiss(toastId);
    refused(err, SAVE_FAILED);
    return null;
  } finally {
    useLibrarySaving.setState((s) => ({ saving: s.saving - 1 }));
  }
}

/** Save inputs kept elsewhere, such as the frames a job was sent with, as a
 * set; `maps` are maps they were sent with, by key, with their bytes. */
export async function saveInputsAsSet(
  inputs: Inputs,
  maps: ReadonlyMap<string, { cid: string; blob: Blob }> = new Map(),
): Promise<ItemEntryV2 | null> {
  if (!inputs.frames.some(holdsContent)) {
    toast.info(NOTHING_TO_SAVE);
    return null;
  }
  return storeEntry({
    kind: "set",
    name: setName(Date.now(), inputs.frames),
    inputs,
    maps: [...maps].map(([key, map]) => ({ key, cid: map.cid, blob: map.blob })),
  });
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
): Promise<ItemEntryV2 | null> {
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
  return storeEntry({
    kind,
    name:
      kind === "set"
        ? setName(now, frames)
        : defaultEntryName(kind, frames[0], position, now, timeZone),
    inputs: {
      frames,
      size: { width, height },
      sizeSource: pick && frames.some((f) => f.id === pick.frameId) ? pick : null,
    },
    maps: maps.map((m) => ({ key: m.key, cid: m.cid, blob: m.blob })),
  });
}
