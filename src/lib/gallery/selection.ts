// Which files a Gallery action takes, and what a new file list leaves of the
// selection and of the lightbox's place: pure over the store's values. A new
// list is matched by path, since a load can give a file another id.

import type { GalleryFile } from "@/api/types/gallery";

export interface TargetState {
  selectedIds: ReadonlySet<string>;
  /** The files as the grid shows them: searched and sorted. */
  sortedFiles: readonly GalleryFile[];
  /** The card with keyboard focus. */
  focusedId: string | null;
  /** The file the metadata panel shows after a single click. */
  selectedFile: GalleryFile | null;
}

/** The files an action takes: the selection as the grid shows it, else the
 * focused card, else the single-clicked file while the grid shows it. */
export function galleryTargets(state: TargetState): GalleryFile[] {
  const shown = (id: string) => state.sortedFiles.find((f) => f.id === id);
  if (state.selectedIds.size > 0)
    return state.sortedFiles.filter((f) => state.selectedIds.has(f.id));
  const focused = state.focusedId === null ? undefined : shown(state.focusedId);
  if (focused) return [focused];
  const clicked = state.selectedFile === null ? undefined : shown(state.selectedFile.id);
  return clicked ? [clicked] : [];
}

/** The selected files the grid shows, and how many a search hides. */
export function shownSelection(
  selectedIds: ReadonlySet<string>,
  sortedFiles: readonly GalleryFile[],
): { shown: GalleryFile[]; hidden: number } {
  const shown = sortedFiles.filter((f) => selectedIds.has(f.id));
  return { shown, hidden: selectedIds.size - shown.length };
}

/** The selection and the single-clicked file a new file list keeps; `left`
 * when the single-clicked file is no longer in it. */
export function pruneSelection(
  selection: { selectedIds: ReadonlySet<string>; selectedFile: GalleryFile | null },
  before: readonly GalleryFile[],
  after: readonly GalleryFile[],
): { selectedIds: Set<string>; selectedFile: GalleryFile | null; left: boolean } {
  const byPath = new Map(after.map((f) => [f.fullPath, f]));
  const pathOf = new Map(before.map((f) => [f.id, f.fullPath]));
  const selectedIds = new Set<string>();
  for (const id of selection.selectedIds) {
    const path = pathOf.get(id);
    const found = path === undefined ? undefined : byPath.get(path);
    if (found) selectedIds.add(found.id);
  }
  const clicked = selection.selectedFile;
  const selectedFile = clicked ? (byPath.get(clicked.fullPath) ?? null) : null;
  return { selectedIds, selectedFile, left: clicked !== null && selectedFile === null };
}

/** Where the lightbox's file sits in a new sorted list; null when it left the
 * folder. */
export function relocate(
  index: number,
  before: readonly GalleryFile[],
  after: readonly GalleryFile[],
): number | null {
  const path = before[index]?.fullPath;
  if (path === undefined) return null;
  const found = after.findIndex((f) => f.fullPath === path);
  return found < 0 ? null : found;
}
