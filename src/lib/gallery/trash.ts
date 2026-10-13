// The Gallery's Trash folder over the server's list: its files as Gallery
// files, the time they sort by, and the cached thumbnails a trash or a
// restore carries to the files' new paths.

import type { CachedThumb, GalleryFile } from "@/api/types/gallery";
import type { ItemTrashedFileV2, ResTrashedOutputsV2 } from "@/api/types/media";
import type { RemovedByOthers } from "@/lib/media/text";

/** The Trash folder's place among the Gallery's folders; never a path. */
export const TRASH_FOLDER = "enso:trash";

export function isTrashFolder(folder: string | null): boolean {
  return folder === TRASH_FOLDER;
}

/** The trash as Gallery files, each under the folder it came from, so a
 * search finds it by that folder and two files of one name stay apart. */
export function trashFiles(items: readonly ItemTrashedFileV2[]): GalleryFile[] {
  return items.map((item) => ({
    folder: TRASH_FOLDER,
    relativePath: `${item.folder_label.replace(/\/+$/, "")}/${item.name}`,
    fullPath: item.path,
    id: `trash:${item.id}`,
    trash: {
      id: item.id,
      from: item.folder_label,
      trashedAt: item.trashed_at,
      trashedBy: item.trashed_by ?? null,
      expiresAt: item.expires_at,
      bytes: item.bytes,
      lost: item.lost,
    },
  }));
}

/** The time a file sorts by: when it went to the trash in the Trash folder,
 * else when it was written. */
export function sortTime(file: GalleryFile, thumb: CachedThumb | undefined): number {
  return file.trash ? file.trash.trashedAt : (thumb?.mtime ?? 0);
}

/** The cached thumbnails of files that moved, under their new paths and
 * folders, so the folder they arrive in shows them without a render. */
export function rekeyThumbs(
  found: ReadonlyMap<string, CachedThumb>,
  moves: readonly { from: string; to: string }[],
  folderOf: (path: string) => string,
): CachedThumb[] {
  return moves.flatMap(({ from, to }) => {
    const thumb = found.get(from);
    return thumb ? [{ ...thumb, path: to, folder: folderOf(to) }] : [];
  });
}

/** Who else deleted these files from their folders, for the dialogs that
 * delete them for everyone. */
export function filesRemovedByOthers(
  files: readonly GalleryFile[],
  me: string | null,
): RemovedByOthers {
  const names = files.flatMap((f) =>
    f.trash?.trashedBy && f.trash.trashedBy !== me ? [f.trash.trashedBy] : [],
  );
  return { count: names.length, name: new Set(names).size === 1 ? (names[0] ?? null) : null };
}

/** What became of an output's file: in the trash, with its item and when it
 * goes, or deleted from it within the hour; null where it was left. */
export type OutputFileState =
  { state: "trashed"; item: string; expiresAt: number } | { state: "gone" } | null;

export function trashedState(
  outputId: string | null,
  map: ResTrashedOutputsV2 | undefined,
): OutputFileState {
  if (outputId === null || !map) return null;
  const trashed = Object.hasOwn(map.trashed, outputId) ? map.trashed[outputId] : undefined;
  if (trashed) return { state: "trashed", item: trashed.item, expiresAt: trashed.expires_at };
  return Object.hasOwn(map.gone, outputId) ? { state: "gone" } : null;
}

/** The outputs map with these items' outputs in the trash. */
export function outputsTrashed(
  map: ResTrashedOutputsV2,
  items: readonly ItemTrashedFileV2[],
): ResTrashedOutputsV2 {
  const added = items.flatMap((item) =>
    item.output_ids.map((id) => [id, { item: item.id, expires_at: item.expires_at }] as const),
  );
  if (added.length === 0) return map;
  return { ...map, trashed: { ...map.trashed, ...Object.fromEntries(added) } };
}

/** The outputs map once these items left the trash: restored when `goneAt` is
 * null, else deleted for good at that time. */
export function outputsLeft(
  map: ResTrashedOutputsV2,
  items: ReadonlySet<string>,
  goneAt: number | null,
): ResTrashedOutputsV2 {
  const entries = Object.entries(map.trashed);
  const leaving = entries.filter(([, entry]) => items.has(entry.item));
  if (leaving.length === 0) return map;
  return {
    trashed: Object.fromEntries(entries.filter(([, entry]) => !items.has(entry.item))),
    gone:
      goneAt === null
        ? map.gone
        : { ...map.gone, ...Object.fromEntries(leaving.map(([id]) => [id, goneAt])) },
  };
}
