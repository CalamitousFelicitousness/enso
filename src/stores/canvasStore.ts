import { create } from "zustand";
import { persist, type StorageValue } from "zustand/middleware";
import { createGatedStorage, idbBackend } from "@/lib/idbStorage";
import { loose } from "@/lib/inputs/loose";
import { reportStorageProblem } from "@/lib/storageHealth";
import { DEFAULT_SIZE_MULTIPLE } from "@/lib/sizeCompute";
import type { FrameId } from "@/canvas/frameList";
import type { ViewportState } from "@/canvas/viewportBus";

export type ToolType =
  | "move"
  | "brush"
  | "eraser"
  | "maskBrush"
  | "maskEraser"
  | "rectSelect"
  | "lassoSelect"
  | "colorPicker"
  | "zoom"
  | "pan";

/** How the Images canvas is looked at and worked on. What it holds is the
 * input store's. */
interface CanvasState {
  viewport: ViewportState;
  activeTool: ToolType;
  brushSize: number;
  maskVisible: boolean;
  maskColor: string;
  /** The processed composite the last job returned, by url; not persisted. */
  processedUrl: string | null;
  /** Per-dock collapse override map, keyed by FrameId string: `input:${uuid}`
   * for frames, `"output"` for the Output dock. */
  panelCollapsedOverrides: Map<string, boolean>;
  canvasMode: "focus" | "canvas";
  focusedFrameId: FrameId | null;
  focusFitTrigger: number;
  modeLocked: boolean;
  /** Width and height step of the loaded model; not persisted. */
  sizeMultiple: number;

  setViewport: (viewport: Partial<ViewportState>) => void;
  setCanvasMode: (mode: "focus" | "canvas") => void;
  setFocusedFrame: (id: FrameId) => void;
  switchToCanvasMode: () => void;
  bumpFocusFitTrigger: () => void;
  setModeLocked: (locked: boolean) => void;
  setActiveTool: (tool: ToolType) => void;
  setBrushSize: (size: number) => void;
  setMaskVisible: (visible: boolean) => void;
  setMaskColor: (color: string) => void;
  setProcessedUrl: (url: string | null) => void;
  togglePanelCollapsed: (key: string, currentCollapsed: boolean) => void;
  setSizeMultiple: (multiple: number) => void;
}

interface PersistedCanvasState {
  viewport: ViewportState;
  activeTool: ToolType;
  brushSize: number;
  maskVisible: boolean;
  maskColor: string;
  panelCollapsedOverrides: [string, boolean][];
  canvasMode: "focus" | "canvas";
  focusedFrameId: FrameId | null;
  modeLocked: boolean;
}

const canvasRecords = idbBackend("enso-canvas", "state");

/** The view settings of the canvas record an older build left, which also
 * held the input frames. Those records stay as they are for that build. */
async function viewOfLegacyRecord(): Promise<StorageValue<PersistedCanvasState> | null> {
  try {
    for (const key of ["enso-canvas-v4", "enso-canvas"]) {
      const raw = await canvasRecords.get(key);
      const record = loose<StorageValue<PersistedCanvasState>>(
        typeof raw === "string" ? JSON.parse(raw) : raw,
      );
      const state = loose<PersistedCanvasState>(record?.state);
      if (!state) continue;
      const kept = {
        viewport: state.viewport,
        activeTool: state.activeTool,
        brushSize: state.brushSize,
        maskVisible: state.maskVisible,
        maskColor: state.maskColor,
        panelCollapsedOverrides: state.panelCollapsedOverrides,
        canvasMode: state.canvasMode,
        focusedFrameId: state.focusedFrameId,
        modeLocked: state.modeLocked,
      };
      return { state: kept as PersistedCanvasState, version: 5 };
    }
  } catch (err) {
    console.error("[canvas] view settings of an older build could not be read", err);
  }
  return null;
}

const canvasStorage = createGatedStorage<PersistedCanvasState>(canvasRecords, "enso-canvas/state", {
  seed: viewOfLegacyRecord,
  onWriteError: () => reportStorageProblem({ kind: "write", id: "canvas", what: "canvas view" }),
  onWriteRecovered: () => reportStorageProblem({ kind: "resolved", id: "canvas" }),
});

export const useCanvasStore = create<CanvasState>()(
  persist(
    (set) => ({
      viewport: { x: 0, y: 0, scale: 1 },
      activeTool: "move",
      brushSize: 20,
      maskVisible: true,
      maskColor: "#ff000080",
      processedUrl: null,
      panelCollapsedOverrides: new Map<string, boolean>(),
      canvasMode: "focus",
      focusedFrameId: null,
      focusFitTrigger: 0,
      modeLocked: false,
      sizeMultiple: DEFAULT_SIZE_MULTIPLE,

      setCanvasMode: (mode) =>
        set((s) => ({
          canvasMode: mode,
          focusedFrameId: mode === "focus" && !s.focusedFrameId ? "output" : s.focusedFrameId,
        })),
      setFocusedFrame: (id) => set({ focusedFrameId: id }),
      switchToCanvasMode: () =>
        set((s) => (s.canvasMode === "canvas" ? s : { canvasMode: "canvas" })),
      bumpFocusFitTrigger: () => set((s) => ({ focusFitTrigger: s.focusFitTrigger + 1 })),
      setModeLocked: (locked) => set({ modeLocked: locked }),
      setViewport: (viewport) => set((s) => ({ viewport: { ...s.viewport, ...viewport } })),

      setActiveTool: (tool) => set({ activeTool: tool }),
      setBrushSize: (size) => set({ brushSize: size }),
      setMaskVisible: (visible) => set({ maskVisible: visible }),
      setMaskColor: (color) => set({ maskColor: color }),
      setProcessedUrl: (url) => set({ processedUrl: url }),
      setSizeMultiple: (multiple) => set({ sizeMultiple: multiple }),

      togglePanelCollapsed: (key, currentCollapsed: boolean) =>
        set((s) => {
          const newMap = new Map(s.panelCollapsedOverrides);
          newMap.set(key, !currentCollapsed);
          return { panelCollapsedOverrides: newMap };
        }),
    }),
    {
      // A new key per record format: the builds that wrote "enso-canvas-v4"
      // and "enso-canvas" still read them after a rollback.
      name: "enso-canvas-v5",
      storage: canvasStorage,
      version: 5,
      onRehydrateStorage: () => (_state, error) => {
        if (!error) {
          reportStorageProblem({ kind: "resolved", id: "canvas" });
          return;
        }
        reportStorageProblem({
          kind: "read",
          id: "canvas",
          what: "canvas view",
          retry: () => void useCanvasStore.persist.rehydrate(),
          startEmpty: () => canvasStorage.startEmpty(),
        });
      },
      partialize: (state): PersistedCanvasState => ({
        viewport: state.viewport,
        activeTool: state.activeTool,
        brushSize: state.brushSize,
        maskVisible: state.maskVisible,
        maskColor: state.maskColor,
        panelCollapsedOverrides: [...state.panelCollapsedOverrides.entries()],
        canvasMode: state.canvasMode,
        focusedFrameId: state.focusedFrameId,
        modeLocked: state.modeLocked,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<PersistedCanvasState> | undefined;
        if (!saved) return current;
        return {
          ...current,
          viewport: saved.viewport ?? current.viewport,
          activeTool: saved.activeTool ?? current.activeTool,
          brushSize: saved.brushSize ?? current.brushSize,
          maskVisible: saved.maskVisible ?? current.maskVisible,
          maskColor: saved.maskColor ?? current.maskColor,
          panelCollapsedOverrides: saved.panelCollapsedOverrides
            ? new Map(saved.panelCollapsedOverrides)
            : current.panelCollapsedOverrides,
          canvasMode: saved.canvasMode ?? "focus",
          focusedFrameId: saved.focusedFrameId ?? null,
          modeLocked: saved.modeLocked ?? false,
        };
      },
    },
  ),
);
