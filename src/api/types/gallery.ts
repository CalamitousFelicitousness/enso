export interface BrowserFolder {
  path: string;
  label: string;
  /** Why the Gallery keeps this folder's files, when it does: the reference set or a model folder. */
  kept?: string | null;
}

export interface BrowserSubdir {
  path: string;
  label: string;
  /** Why the Gallery keeps this folder's files, when it does. */
  kept?: string | null;
}

export interface BrowserThumb {
  exif: string;
  data: string;
  width: number;
  height: number;
  size: number;
  mtime: number;
}

/** A file of the Trash folder: where it came from and when it goes. */
export interface TrashFacts {
  /** The item's id on the server. */
  id: string;
  /** The folder it came from, as the Gallery names it. */
  from: string;
  trashedAt: number;
  trashedBy: string | null;
  expiresAt: number;
  bytes: number;
  /** Its file is gone from the trash. */
  lost: boolean;
}

export interface GalleryFile {
  folder: string;
  relativePath: string;
  fullPath: string;
  id: string;
  trash?: TrashFacts;
}

export interface ParsedGenerationInfo {
  prompt: string;
  negativePrompt: string;
  params: Record<string, string>;
  /** The Enso job a trailing stamp names; null without one. */
  jobId: string | null;
}

export type GallerySortField = "name" | "mtime" | "size" | "width";
export type GallerySortDir = "asc" | "desc";
export interface GallerySort {
  field: GallerySortField;
  dir: GallerySortDir;
}

export interface CachedThumb {
  path: string;
  folder: string;
  data: string;
  width: number;
  height: number;
  size: number;
  mtime: number;
  exif: string;
}
