// The Gallery's folder listing: each entry's file with the mtime and size
// that tell it from an earlier file written at the same path, and which
// cached thumbnails still belong to the files listed.

import type { CachedThumb, GalleryFile } from "@/api/types/gallery";

const PATH_SEP = "##F##";
const STAMP_SEP = "##T##";

function stampOf(text: string | null): Pick<GalleryFile, "mtime" | "size"> {
  const match = text === null ? null : /^(\d+)\.(\d+)$/.exec(text);
  return match ? { mtime: Number(match[1]), size: Number(match[2]) } : { mtime: null, size: null };
}

/** One entry, `<folder>##F##<path under it>##T##<mtime ms>.<size>` with each
 * path URI-encoded; its id is the entry without the stamp, so it names the path. */
export function parseFileEntry(raw: string): GalleryFile {
  const cut = raw.lastIndexOf(STAMP_SEP);
  const id = cut < 0 ? raw : raw.slice(0, cut);
  const stamp = stampOf(cut < 0 ? null : raw.slice(cut + STAMP_SEP.length));
  const idx = id.indexOf(PATH_SEP);
  if (idx < 0) {
    const decoded = decodeURIComponent(id);
    return { folder: "", relativePath: decoded, fullPath: decoded, id, ...stamp };
  }
  const folder = decodeURIComponent(id.slice(0, idx));
  const relativePath = decodeURIComponent(id.slice(idx + PATH_SEP.length));
  const fullPath = folder.replace(/\/+$/, "") + "/" + relativePath;
  return { folder, relativePath, fullPath, id, ...stamp };
}

export function sameStamp(a: GalleryFile, b: GalleryFile): boolean {
  return a.mtime === b.mtime && a.size === b.size;
}

/** Whether a cached thumbnail was drawn from this file, not from an earlier
 * one at its path; never for a file listed without a stamp. */
export function thumbFits(file: GalleryFile, thumb: CachedThumb): boolean {
  return file.mtime !== null && thumb.mtime === file.mtime && thumb.size === file.size;
}

/** The files of `after` that `before` did not list, or listed with another stamp. */
export function changedFiles(
  before: readonly GalleryFile[],
  after: readonly GalleryFile[],
): GalleryFile[] {
  const earlier = new Map(before.map((f) => [f.id, f]));
  return after.filter((f) => {
    const was = earlier.get(f.id);
    return was === undefined || !sameStamp(was, f);
  });
}

/** The thumbnails a list read again keeps: each listed file's, unless the file
 * was written again since `before` listed it and the thumbnail is of the earlier one. */
export function carriedThumbs(
  before: readonly GalleryFile[],
  after: readonly GalleryFile[],
  thumbs: ReadonlyMap<string, CachedThumb>,
): Map<string, CachedThumb> {
  const earlier = new Map(before.map((f) => [f.id, f]));
  const kept = new Map<string, CachedThumb>();
  for (const file of after) {
    const thumb = thumbs.get(file.id);
    if (!thumb) continue;
    const was = earlier.get(file.id);
    if ((was !== undefined && sameStamp(was, file)) || thumbFits(file, thumb))
      kept.set(file.id, thumb);
  }
  return kept;
}
