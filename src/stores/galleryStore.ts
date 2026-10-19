import { create } from "zustand";
import type {
  BrowserFolder,
  GalleryFile,
  GallerySort,
  GallerySortField,
  GallerySortDir,
  CachedThumb,
} from "@/api/types/gallery";
import { getCachedFolder } from "@/lib/folderCache";
import { pruneSelection, relocate } from "@/lib/gallery/selection";

const SORT_STORAGE_KEY = "enso-gallery-sort";
const DEFAULT_SORT: GallerySort = { field: "name", dir: "asc" };

const loadPersistedSort = (): GallerySort => {
  try {
    const raw = localStorage.getItem(SORT_STORAGE_KEY);
    if (!raw) return DEFAULT_SORT;
    const parsed = JSON.parse(raw) as Partial<GallerySort>;
    const fields: GallerySortField[] = ["name", "mtime", "size", "width"];
    const dirs: GallerySortDir[] = ["asc", "desc"];
    if (
      parsed &&
      typeof parsed === "object" &&
      fields.includes(parsed.field as GallerySortField) &&
      dirs.includes(parsed.dir as GallerySortDir)
    ) {
      return { field: parsed.field!, dir: parsed.dir! };
    }
  } catch {
    // quota, privacy mode, malformed JSON - fall through to default
  }
  return DEFAULT_SORT;
};

const savePersistedSort = (sort: GallerySort): void => {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort));
  } catch {
    // ignore quota/privacy errors
  }
};

const PICTURE_ONLY_STORAGE_KEY = "enso-gallery-picture-only";

const loadPictureOnly = (): boolean => {
  try {
    return localStorage.getItem(PICTURE_ONLY_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

const savePictureOnly = (on: boolean): void => {
  try {
    localStorage.setItem(PICTURE_ONLY_STORAGE_KEY, on ? "1" : "0");
  } catch {
    // ignore quota/privacy errors
  }
};

interface GalleryState {
  folders: BrowserFolder[];
  activeFolder: string | null;
  /** Why the active folder's files cannot be removed or moved, from its card. */
  activeKept: string | null;

  files: GalleryFile[];
  isLoadingFiles: boolean;
  isRefreshing: boolean;
  loadProgress: { loaded: number; total: number | null };

  thumbs: Map<string, CachedThumb>;

  sortedFiles: GalleryFile[];

  selectedFile: GalleryFile | null;
  selectedThumb: CachedThumb | null;
  /** The single-clicked file left the folder when it was read again. */
  selectionLeft: boolean;
  lightboxIndex: number | null;

  selectedIds: Set<string>;
  selectionAnchor: number | null;

  sort: GallerySort;
  searchQuery: string;
  thumbSize: number;
  layoutMode: "grid" | "masonry";
  metadataPanelOpen: boolean;
  /** The preview panel shows the picture alone, its details hidden. */
  pictureOnly: boolean;

  setFolders: (f: BrowserFolder[]) => void;
  setActiveFolder: (path: string | null, kept?: string | null) => void;
  setFiles: (files: GalleryFile[]) => void;
  appendFile: (file: GalleryFile) => void;
  setLoadingFiles: (loading: boolean) => void;
  setRefreshing: (refreshing: boolean) => void;
  setLoadProgress: (loaded: number, total: number | null) => void;
  setThumb: (id: string, thumb: CachedThumb) => void;
  setThumbsBatch: (entries: [string, CachedThumb][]) => void;
  setSortedFiles: (files: GalleryFile[]) => void;
  selectFile: (file: GalleryFile | null, thumb?: CachedThumb | null) => void;
  openLightbox: (index: number) => void;
  closeLightbox: () => void;
  navigateLightbox: (delta: number, maxIndex: number) => void;
  setSort: (sort: GallerySort) => void;
  setSearchQuery: (q: string) => void;
  setThumbSize: (size: number) => void;
  setLayoutMode: (mode: "grid" | "masonry") => void;
  toggleMetadataPanel: () => void;
  togglePictureOnly: () => void;
  toggleSelect: (fileId: string, index: number, shift: boolean, ctrl: boolean) => void;
  selectAll: () => void;
  deselectAll: () => void;
  removeFilesFromStore: (ids: string[]) => void;
  reset: () => void;
}

/** What opening a folder clears: the choice and the view of the one before. */
const OPENED = {
  selectedFile: null,
  selectedThumb: null,
  selectionLeft: false,
  lightboxIndex: null,
  selectionAnchor: null,
  isLoadingFiles: false,
  isRefreshing: false,
} as const;

const sameIds = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((id) => b.has(id));

/** The lightbox's place in a new sorted list: its file again, else closed. */
function lightboxIn(
  index: number | null,
  before: readonly GalleryFile[],
  after: readonly GalleryFile[],
): number | null {
  return index === null ? null : relocate(index, before, after);
}

export const useGalleryStore = create<GalleryState>()((set) => ({
  folders: [],
  activeFolder: null,
  activeKept: null,
  files: [],
  isLoadingFiles: false,
  isRefreshing: false,
  loadProgress: { loaded: 0, total: null },
  thumbs: new Map(),
  sortedFiles: [],
  selectedFile: null,
  selectedThumb: null,
  selectionLeft: false,
  lightboxIndex: null,
  selectedIds: new Set<string>(),
  selectionAnchor: null,
  sort: loadPersistedSort(),
  searchQuery: "",
  thumbSize: 180,
  layoutMode: "grid",
  metadataPanelOpen: true,
  pictureOnly: loadPictureOnly(),

  setFolders: (folders) => set({ folders }),
  setActiveFolder: (path, kept = null) => {
    if (path === null) {
      return set({
        ...OPENED,
        selectedIds: new Set<string>(),
        activeFolder: null,
        activeKept: null,
        files: [],
        thumbs: new Map(),
        loadProgress: { loaded: 0, total: null },
      });
    }
    const cached = getCachedFolder(path);
    return set({
      ...OPENED,
      selectedIds: new Set<string>(),
      activeFolder: path,
      activeKept: kept,
      files: cached ? cached.files : [],
      thumbs: cached ? new Map(cached.thumbs) : new Map(),
      loadProgress: cached
        ? { loaded: cached.files.length, total: cached.files.length }
        : { loaded: 0, total: null },
    });
  },
  // A list read again keeps only the choices whose files are still in it
  setFiles: (files) =>
    set((s) => {
      const kept = pruneSelection(s, s.files, files);
      return {
        files,
        selectedIds: sameIds(kept.selectedIds, s.selectedIds) ? s.selectedIds : kept.selectedIds,
        selectedFile:
          kept.selectedFile?.id === s.selectedFile?.id ? s.selectedFile : kept.selectedFile,
        selectedThumb: kept.selectedFile ? s.selectedThumb : null,
        selectionLeft: s.selectionLeft || kept.left,
      };
    }),
  appendFile: (file) =>
    set((s) => ({
      files: [...s.files, file],
      loadProgress: { loaded: s.loadProgress.loaded + 1, total: s.loadProgress.total },
    })),
  setLoadingFiles: (loading) => set({ isLoadingFiles: loading }),
  setRefreshing: (refreshing) => set({ isRefreshing: refreshing }),
  setLoadProgress: (loaded, total) => set({ loadProgress: { loaded, total } }),
  setThumb: (id, thumb) =>
    set((s) => {
      const m = new Map(s.thumbs);
      m.set(id, thumb);
      return { thumbs: m };
    }),
  setThumbsBatch: (entries) =>
    set((s) => {
      if (entries.length === 0) return {};
      const m = new Map(s.thumbs);
      for (const [id, thumb] of entries) m.set(id, thumb);
      return { thumbs: m };
    }),
  setSortedFiles: (sortedFiles) =>
    set((s) => ({
      sortedFiles,
      lightboxIndex: lightboxIn(s.lightboxIndex, s.sortedFiles, sortedFiles),
    })),
  selectFile: (file, thumb) =>
    set({ selectedFile: file, selectedThumb: thumb ?? null, selectionLeft: false }),
  openLightbox: (index) => set({ lightboxIndex: index }),
  closeLightbox: () => set({ lightboxIndex: null }),
  navigateLightbox: (delta, maxIndex) =>
    set((s) => {
      if (s.lightboxIndex === null) return {};
      const next = s.lightboxIndex + delta;
      if (next < 0 || next > maxIndex) return {};
      return { lightboxIndex: next };
    }),
  setSort: (sort) => {
    savePersistedSort(sort);
    set({ sort });
  },
  setSearchQuery: (q) => set({ searchQuery: q }),
  setThumbSize: (size) => set({ thumbSize: Math.max(120, Math.min(320, size)) }),
  setLayoutMode: (layoutMode) => set({ layoutMode }),
  toggleMetadataPanel: () => set((s) => ({ metadataPanelOpen: !s.metadataPanelOpen })),
  togglePictureOnly: () =>
    set((s) => {
      savePictureOnly(!s.pictureOnly);
      return { pictureOnly: !s.pictureOnly };
    }),
  toggleSelect: (fileId, index, shift, ctrl) =>
    set((s) => {
      if (shift && s.selectionAnchor !== null) {
        const start = Math.min(s.selectionAnchor, index);
        const end = Math.max(s.selectionAnchor, index);
        const next = new Set(s.selectedIds);
        for (let i = start; i <= end; i++) {
          if (i < s.sortedFiles.length) next.add(s.sortedFiles[i].id);
        }
        return { selectedIds: next };
      }
      if (ctrl) {
        const next = new Set(s.selectedIds);
        if (next.has(fileId)) next.delete(fileId);
        else next.add(fileId);
        return { selectedIds: next, selectionAnchor: index };
      }
      return { selectedIds: new Set([fileId]), selectionAnchor: index };
    }),
  selectAll: () => set((s) => ({ selectedIds: new Set(s.sortedFiles.map((f) => f.id)) })),
  deselectAll: () => set({ selectedIds: new Set<string>(), selectionAnchor: null }),
  removeFilesFromStore: (ids) =>
    set((s) => {
      const idSet = new Set(ids);
      const files = s.files.filter((f) => !idSet.has(f.id));
      const sortedFiles = s.sortedFiles.filter((f) => !idSet.has(f.id));
      const thumbs = new Map(s.thumbs);
      const selectedIds = new Set(s.selectedIds);
      for (const id of ids) {
        thumbs.delete(id);
        selectedIds.delete(id);
      }
      const selectedFile = s.selectedFile && idSet.has(s.selectedFile.id) ? null : s.selectedFile;
      const selectedThumb = selectedFile ? s.selectedThumb : null;
      return {
        files,
        sortedFiles,
        thumbs,
        selectedIds,
        selectedFile,
        selectedThumb,
        lightboxIndex: lightboxIn(s.lightboxIndex, s.sortedFiles, sortedFiles),
        loadProgress: { loaded: files.length, total: files.length },
      };
    }),
  reset: () =>
    set({
      ...OPENED,
      selectedIds: new Set<string>(),
      folders: [],
      activeFolder: null,
      activeKept: null,
      files: [],
      loadProgress: { loaded: 0, total: null },
      thumbs: new Map(),
      sortedFiles: [],
      searchQuery: "",
      thumbSize: 180,
      layoutMode: "grid",
      metadataPanelOpen: true,
    }),
}));
