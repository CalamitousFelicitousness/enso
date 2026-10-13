// The Gallery's trash over the server: the list as a query, and the writes a
// folder and the Trash folder send. Each write applies its answer to the
// Gallery's store, its caches and the list, then says what it did.

import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, api, refusalOf } from "../client";
import { queryClient } from "../queryClient";
import { GALLERY_TRASH_KEY, OUTPUT_JOBS_KEY, retryUnlessRefused, storeOffIn } from "../queryKeys";
import type { GalleryFile } from "../types/gallery";
import type {
  ItemTrashedFileV2,
  ResFreedV2,
  ResGalleryTrashV2,
  ResRestoredV2,
  ResTrashedV2,
} from "../types/media";
import { offerUndo } from "@/inputs/undo";
import { invalidateFolder, invalidateFoldersHolding } from "@/lib/folderCache";
import {
  DELETE_NOW_FAILED,
  RESTORE_FAILED,
  TRASH_FAILED,
  filesDeletedText,
  filesMovedToTrashText,
  filesRestoredText,
  hiddenLeftText,
  notRestoredText,
  notTrashedText,
  restoredAsText,
  restoredWithoutText,
} from "@/lib/gallery/text";
import { TRASH_FOLDER, rekeyThumbs } from "@/lib/gallery/trash";
import { aboutSize, OLDER_SERVER } from "@/lib/media/text";
import { batchGetThumbs, deleteThumbs, putThumbs } from "@/lib/thumbnailCache";
import { useGalleryStore } from "@/stores/galleryStore";
import { refreshFolder } from "./useGallery";

/** Ids or paths per request: the routes take at most this many. */
const CHUNK = 1000;

/** Why the trash cannot be used: the media store is off, or the server is older. */
export function trashOffIn(err: unknown): string | null {
  return storeOffIn(err) ?? (err instanceof ApiError && err.status === 404 ? OLDER_SERVER : null);
}

/** The files in the server's trash, kept current by its events. */
export function useGalleryTrash(enabled: boolean) {
  return useQuery({
    queryKey: GALLERY_TRASH_KEY,
    queryFn: () => api.get<ResGalleryTrashV2>("/sdapi/v2/browser/trash"),
    enabled,
    staleTime: Infinity,
    retry: retryUnlessRefused,
  });
}

function describe(err: unknown): string {
  return refusalOf(err)?.message ?? (err instanceof Error ? err.message : String(err));
}

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const dirName = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));

/** Send in chunks, stopping at the first failure; what landed comes back either way. */
async function inChunks<T, A>(
  values: readonly T[],
  send: (part: T[]) => Promise<A>,
): Promise<{ answers: A[]; error: unknown }> {
  const answers: A[] = [];
  for (let i = 0; i < values.length; i += CHUNK) {
    try {
      answers.push(await send(values.slice(i, i + CHUNK)));
    } catch (err) {
      return { answers, error: err };
    }
  }
  return { answers, error: null };
}

/** The cached thumbnails of moved files, under their new paths; a miss is drawn again when shown. */
async function carryThumbs(
  moves: { from: string; to: string }[],
  folderOf: (path: string) => string,
) {
  if (moves.length === 0) return;
  try {
    const found = await batchGetThumbs(moves.map((move) => move.from));
    await putThumbs(rekeyThumbs(found, moves, folderOf));
    await deleteThumbs(moves.map((move) => move.from));
  } catch {
    // The thumbnails are made again when the files are shown
  }
}

function listed(): Map<string, ItemTrashedFileV2> {
  const list = queryClient.getQueryData<ResGalleryTrashV2>(GALLERY_TRASH_KEY);
  return new Map((list?.items ?? []).map((item) => [item.id, item]));
}

/** Take items out of the cached list and out of the Trash folder's files. */
function dropListed(ids: readonly string[]) {
  const gone = new Set(ids);
  queryClient.setQueryData<ResGalleryTrashV2>(GALLERY_TRASH_KEY, (old) => {
    if (!old) return old;
    const items = old.items.filter((item) => !gone.has(item.id));
    const dropped = old.items.filter((item) => gone.has(item.id));
    const bytes = dropped.reduce((sum, item) => sum + (item.lost ? 0 : item.bytes), 0);
    return { ...old, items, total: items.length, bytes: Math.max(0, old.bytes - bytes) };
  });
  const store = useGalleryStore.getState();
  if (store.activeFolder === TRASH_FOLDER)
    store.removeFilesFromStore(ids.map((id) => `trash:${id}`));
}

function reportErrors(
  title: string,
  errors: { error: string; file?: string; name?: string }[],
  stopped: unknown,
) {
  const [first] = errors;
  const reason = first
    ? `${first.name || baseName(first.file ?? "")}: ${first.error}`
    : describe(stopped);
  const more = errors.length > 1 ? `, and ${errors.length - 1} more` : "";
  toast.error(title, { description: `${reason}${more}` });
}

/** Move files to the trash by their paths, with their sidecars; Undo brings them back. */
export async function trashPaths(paths: readonly string[], hidden = 0): Promise<boolean> {
  const { answers, error } = await inChunks(paths, (files) =>
    api.post<ResTrashedV2>("/sdapi/v2/browser/trash", { files }),
  );
  const trashed = answers.flatMap((answer) => answer.trashed);
  const moved = answers.flatMap((answer) => answer.moved);
  const errors = answers.flatMap((answer) => answer.errors);
  if (moved.length > 0) {
    const store = useGalleryStore.getState();
    const gone = new Set(moved.map((m) => m.file));
    store.removeFilesFromStore(store.files.filter((f) => gone.has(f.fullPath)).map((f) => f.id));
    if (store.activeFolder) invalidateFolder(store.activeFolder);
    invalidateFoldersHolding([...gone]);
    void carryThumbs(
      moved.map((m) => ({ from: m.file, to: m.path })),
      () => TRASH_FOLDER,
    );
  }
  if (trashed.length > 0) {
    queryClient.setQueryData<ResGalleryTrashV2>(GALLERY_TRASH_KEY, (old) =>
      old
        ? {
            ...old,
            items: [...trashed, ...old.items],
            total: old.total + trashed.length,
            bytes: old.bytes + trashed.reduce((sum, item) => sum + item.bytes, 0),
          }
        : old,
    );
    void queryClient.invalidateQueries({ queryKey: OUTPUT_JOBS_KEY, refetchType: "none" });
  }
  if (errors.length > 0 || error) {
    reportErrors(
      trashed.length === 0 && errors.length === 0 ? TRASH_FAILED : notTrashedText(errors.length),
      errors,
      error,
    );
  }
  if (trashed.length === 0) return false;
  offerUndo(
    filesMovedToTrashText(trashed.length, trashed[0].name),
    hidden > 0 ? hiddenLeftText(hidden) : null,
    () =>
      void restoreTrashed(
        trashed.map((item) => item.id),
        { undoing: true },
      ),
  );
  return true;
}

/** Move Gallery files to the trash; `hidden` counts the selected files a search left. */
export function trashGalleryFiles(files: readonly GalleryFile[], hidden = 0): Promise<boolean> {
  return trashPaths(
    files.map((f) => f.fullPath),
    hidden,
  );
}

/** Bring files back from the trash, each to its own folder or to `folder`.
 * Undo moves them to the trash again; the Undo of a trash says only what came
 * back under another name. */
export async function restoreTrashed(
  ids: readonly string[],
  { folder, undoing = false }: { folder?: string; undoing?: boolean } = {},
): Promise<boolean> {
  const before = listed();
  const { answers, error } = await inChunks(ids, (part) =>
    api.post<ResRestoredV2>("/sdapi/v2/browser/trash/restore", {
      ids: part,
      ...(folder !== undefined && { folder }),
    }),
  );
  const restored = answers.flatMap((answer) => answer.restored);
  const errors = answers.flatMap((answer) => answer.errors);
  if (restored.length > 0) {
    dropListed(restored.map((r) => r.id));
    const paths = restored.map((r) => r.path);
    invalidateFoldersHolding(paths);
    // the folder on screen shows what came back into it now, not at its next poll
    const active = useGalleryStore.getState().activeFolder;
    const under = active ? `${active.replace(/\/+$/, "")}/` : null;
    if (active && under && paths.some((path) => path.startsWith(under))) void refreshFolder(active);
    void queryClient.invalidateQueries({ queryKey: OUTPUT_JOBS_KEY, refetchType: "none" });
    void carryThumbs(
      restored.flatMap((r) => {
        const from = before.get(r.id)?.path;
        return from ? [{ from, to: r.path }] : [];
      }),
      dirName,
    );
  }
  if (errors.length > 0 || error) {
    reportErrors(
      restored.length === 0 && errors.length === 0
        ? RESTORE_FAILED
        : notRestoredText(errors.length),
      errors,
      error,
    );
  }
  if (restored.length === 0) return false;
  const notes = [
    restoredAsText(restored.filter((r) => r.renamed).map((r) => r.name)),
    restoredWithoutText(restored.flatMap((r) => r.left)),
  ].filter((note): note is string => note !== null);
  if (undoing) {
    if (notes.length > 0) toast.info(notes.join(". "));
    return true;
  }
  offerUndo(
    filesRestoredText(restored.length, restored[0].name),
    notes.join(". ") || null,
    () => void trashPaths(restored.map((r) => r.path)),
  );
  return true;
}

function freed(answers: ResFreedV2[]): { ids: string[]; bytes: number } {
  return {
    ids: answers.flatMap((answer) => answer.deleted),
    bytes: answers.reduce((sum, answer) => sum + answer.freed, 0),
  };
}

async function forgetDeleted(ids: string[]) {
  const before = listed();
  dropListed(ids);
  try {
    await deleteThumbs(ids.flatMap((id) => before.get(id)?.path ?? []));
  } catch {
    // Unused thumbnails go with the cache's own trim
  }
}

/** Delete files from the trash for good. */
export async function deleteTrashed(ids: readonly string[]): Promise<boolean> {
  const names = listed();
  const { answers, error } = await inChunks(ids, (part) =>
    api.post<ResFreedV2>("/sdapi/v2/browser/trash/delete", { ids: part }),
  );
  const done = freed(answers);
  await forgetDeleted(done.ids);
  if (error) reportErrors(DELETE_NOW_FAILED, [], error);
  if (done.ids.length === 0) return false;
  toast(filesDeletedText(done.ids.length, names.get(done.ids[0])?.name ?? ""), {
    description: `${aboutSize(done.bytes)} freed`,
  });
  return true;
}

/** Delete every file that was in the trash when its list was read at `asOf`. */
export async function emptyGalleryTrash(asOf: number): Promise<boolean> {
  const names = listed();
  try {
    const answer = await api.post<ResFreedV2>("/sdapi/v2/browser/trash/empty", { as_of: asOf });
    const done = freed([answer]);
    await forgetDeleted(done.ids);
    toast(filesDeletedText(done.ids.length, names.get(done.ids[0] ?? "")?.name ?? ""), {
      description: `${aboutSize(done.bytes)} freed`,
    });
    return true;
  } catch (err) {
    reportErrors(DELETE_NOW_FAILED, [], err);
    return false;
  }
}
