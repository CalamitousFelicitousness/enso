import { create } from "zustand";
import { persist } from "zustand/middleware";
import { base64ToBlob } from "@/lib/utils";
import { createIdbStorage } from "@/lib/idbStorage";
import type { ReferenceKind } from "@/lib/video/referenceMedia";
import type { ViewportState } from "@/canvas/viewportBus";

export interface VideoFrameImage {
  id: string;
  file: File;
  objectUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  kind: ReferenceKind;
  /** Seconds; video/audio only. */
  duration: number | null;
  /** Video only; null = browser could not tell without decoding. */
  hasAudio: boolean | null;
  /** First-frame capture for video cells. */
  posterUrl: string | null;
}

export interface ReferenceMediaMeta {
  kind: ReferenceKind;
  duration?: number | null;
  hasAudio?: boolean | null;
  posterUrl?: string | null;
}

export type VideoSlotId = "init" | "last" | "references";

interface VideoCanvasState {
  viewport: ViewportState;
  initFrame: VideoFrameImage | null;
  lastFrame: VideoFrameImage | null;
  /** Ordered; index 0 = <Picture 1>. Order is semantically load-bearing for
   * ref2va's rotary addressing - never sort, never dedupe. */
  references: VideoFrameImage[];
  /** Last input slot the user touched; paste targets it. */
  activeSlot: VideoSlotId;

  setViewport: (v: Partial<ViewportState>) => void;
  setFrame: (which: "init" | "last", file: File, objectUrl: string, w: number, h: number) => void;
  clearFrame: (which: "init" | "last") => void;
  addReference: (
    file: File,
    objectUrl: string,
    w: number,
    h: number,
    meta?: ReferenceMediaMeta,
  ) => void;
  removeReference: (id: string) => void;
  reorderReference: (from: number, to: number) => void;
  clearReferences: () => void;
  setActiveSlot: (slot: VideoSlotId) => void;
  clearAll: () => void;
}

interface PersistedFrame {
  id: string;
  file: File;
  naturalWidth: number;
  naturalHeight: number;
}

interface PersistedVideoCanvasState {
  viewport: ViewportState;
  initFrame: PersistedFrame | null;
  lastFrame: PersistedFrame | null;
  references?: PersistedFrame[];
}

/** Record shape before version 1, when image bytes were stored as base64. */
interface LegacyPersistedFrame {
  id: string;
  base64: string;
  naturalWidth: number;
  naturalHeight: number;
}

interface LegacyPersistedVideoCanvasState {
  viewport?: ViewportState;
  initFrame?: LegacyPersistedFrame | null;
  lastFrame?: LegacyPersistedFrame | null;
  references?: LegacyPersistedFrame[];
}

const videoCanvasIdbStorage = createIdbStorage<PersistedVideoCanvasState>(
  "enso-video-canvas",
  "state",
  { legacyKey: "enso-video-canvas" },
);

function stripFrame(frame: VideoFrameImage): PersistedFrame {
  return {
    id: frame.id,
    file: frame.file,
    naturalWidth: frame.naturalWidth,
    naturalHeight: frame.naturalHeight,
  };
}

function rehydrateFrame(saved: PersistedFrame | null): VideoFrameImage | null {
  if (!saved?.file) return null;
  return {
    id: saved.id,
    file: saved.file,
    objectUrl: URL.createObjectURL(saved.file),
    naturalWidth: saved.naturalWidth,
    naturalHeight: saved.naturalHeight,
    kind: "image",
    duration: null,
    hasAudio: null,
    posterUrl: null,
  };
}

function migrateFrame(saved: LegacyPersistedFrame | null | undefined): PersistedFrame | null {
  if (!saved?.base64) return null;
  return {
    id: saved.id,
    file: new File([base64ToBlob(saved.base64)], "restored.png", { type: "image/png" }),
    naturalWidth: saved.naturalWidth,
    naturalHeight: saved.naturalHeight,
  };
}

const FRESH_RECORD: PersistedVideoCanvasState = {
  viewport: { x: 0, y: 0, scale: 1 },
  initFrame: null,
  lastFrame: null,
  references: [],
};

export const useVideoCanvasStore = create<VideoCanvasState>()(
  persist(
    (set, get) => ({
      viewport: { x: 0, y: 0, scale: 1 },
      initFrame: null,
      lastFrame: null,
      references: [],
      activeSlot: "init",

      setViewport: (v) => set((s) => ({ viewport: { ...s.viewport, ...v } })),

      setFrame: (which, file, objectUrl, w, h) => {
        const prev = get()[which === "init" ? "initFrame" : "lastFrame"];
        if (prev?.objectUrl) URL.revokeObjectURL(prev.objectUrl);
        const frame: VideoFrameImage = {
          id: crypto.randomUUID(),
          file,
          objectUrl,
          naturalWidth: w,
          naturalHeight: h,
          kind: "image",
          duration: null,
          hasAudio: null,
          posterUrl: null,
        };
        set({ [which === "init" ? "initFrame" : "lastFrame"]: frame, activeSlot: which });
      },

      clearFrame: (which) => {
        const key = which === "init" ? "initFrame" : "lastFrame";
        const prev = get()[key];
        if (prev?.objectUrl) URL.revokeObjectURL(prev.objectUrl);
        set({ [key]: null });
      },

      addReference: (file, objectUrl, w, h, meta) => {
        const frame: VideoFrameImage = {
          id: crypto.randomUUID(),
          file,
          objectUrl,
          naturalWidth: w,
          naturalHeight: h,
          kind: meta?.kind ?? "image",
          duration: meta?.duration ?? null,
          hasAudio: meta?.hasAudio ?? null,
          posterUrl: meta?.posterUrl ?? null,
        };
        set((s) => ({ references: [...s.references, frame], activeSlot: "references" }));
      },

      removeReference: (id) => {
        const prev = get().references.find((r) => r.id === id);
        if (prev?.objectUrl) URL.revokeObjectURL(prev.objectUrl);
        if (prev?.posterUrl) URL.revokeObjectURL(prev.posterUrl);
        set((s) => ({ references: s.references.filter((r) => r.id !== id) }));
      },

      reorderReference: (from, to) => {
        set((s) => {
          if (from < 0 || from >= s.references.length || to < 0 || to >= s.references.length) {
            return s;
          }
          const next = [...s.references];
          const [moved] = next.splice(from, 1);
          if (moved === undefined) return s;
          next.splice(to, 0, moved);
          return { references: next };
        });
      },

      clearReferences: () => {
        for (const r of get().references) {
          if (r.objectUrl) URL.revokeObjectURL(r.objectUrl);
          if (r.posterUrl) URL.revokeObjectURL(r.posterUrl);
        }
        set({ references: [] });
      },

      setActiveSlot: (slot) => set({ activeSlot: slot }),

      clearAll: () => {
        const { initFrame, lastFrame, references } = get();
        if (initFrame?.objectUrl) URL.revokeObjectURL(initFrame.objectUrl);
        if (lastFrame?.objectUrl) URL.revokeObjectURL(lastFrame.objectUrl);
        for (const r of references) {
          if (r.objectUrl) URL.revokeObjectURL(r.objectUrl);
          if (r.posterUrl) URL.revokeObjectURL(r.posterUrl);
        }
        set({ initFrame: null, lastFrame: null, references: [] });
      },
    }),
    {
      // The key changed with the record format; the version 0 record stays
      // under "enso-video-canvas" for builds that still read JSON.
      name: "enso-video-canvas-v1",
      storage: videoCanvasIdbStorage,
      version: 1,
      migrate: (persisted, version) => {
        if (version !== 0) return FRESH_RECORD;
        const legacy = persisted as LegacyPersistedVideoCanvasState;
        return {
          viewport: legacy.viewport ?? FRESH_RECORD.viewport,
          initFrame: migrateFrame(legacy.initFrame),
          lastFrame: migrateFrame(legacy.lastFrame),
          references: (legacy.references ?? []).map(migrateFrame).filter(Boolean),
        };
      },
      partialize: (state): PersistedVideoCanvasState => ({
        viewport: state.viewport,
        initFrame: state.initFrame ? stripFrame(state.initFrame) : null,
        lastFrame: state.lastFrame ? stripFrame(state.lastFrame) : null,
        // All-image lists only: video and audio references carry probe
        // results and poster frames that do not persist, and persisting the
        // image subset would silently renumber <Picture N>.
        references: state.references.every((r) => r.kind === "image")
          ? state.references.map(stripFrame)
          : [],
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<PersistedVideoCanvasState> | undefined;
        if (!saved) return current;
        return {
          ...current,
          viewport: saved.viewport ?? current.viewport,
          initFrame: saved.initFrame ? rehydrateFrame(saved.initFrame) : current.initFrame,
          lastFrame: saved.lastFrame ? rehydrateFrame(saved.lastFrame) : current.lastFrame,
          references: (saved.references ?? []).map(rehydrateFrame).filter(Boolean),
        };
      },
    },
  ),
);
