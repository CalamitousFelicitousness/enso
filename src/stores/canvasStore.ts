import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DB, RECORD, STATE_STORE } from "@/lib/profile/names";
import { createGatedStorage, idbBackend } from "@/lib/idbStorage";
import { reportStorageProblem } from "@/lib/storageHealth";
import { DEFAULT_SIZE_MULTIPLE } from "@/lib/sizeCompute";
import { writeProblems } from "@/inputs/quota";
import type { FrameId } from "@/lib/inputs/frames";
import type { ViewportState } from "@/canvas/viewportBus";

export type ToolType =
  | "move"
  | "brush"
  | "eraser"
  | "maskBrush"
  | "maskEraser"
  | "rectSelect"
  | "lassoSelect"
  | "colorPicker";

const TOOLS: readonly ToolType[] = [
  "move",
  "brush",
  "eraser",
  "maskBrush",
  "maskEraser",
  "rectSelect",
  "lassoSelect",
  "colorPicker",
];

/** How the Images canvas is looked at and worked on. What it holds is the
 * input store's. */
interface CanvasState {
  viewport: ViewportState;
  activeTool: ToolType;
  brushSize: number;
  maskVisible: boolean;
  maskColor: string;
  /** The processed frame whose source pictures are being worked on instead
   * of its map being shown; not persisted. */
  editingFrameId: string | null;
  /** The processed frame whose source is shown while its inset is pointed at. */
  peekingFrameId: string | null;
  /** The frame whose picture is being dragged or transformed; its map waits
   * for the gesture to end, so the node under the pointer stays. Not persisted. */
  gestureFrameId: string | null;
  /** Per-dock collapse override map, keyed by FrameId string: `input:${uuid}`
   * for frames, `"output"` for the Output dock. */
  panelCollapsedOverrides: Map<string, boolean>;
  /** Focus: the camera follows the current frame. Canvas: it follows Show all
   * until the view is moved, then stays. */
  canvasMode: "focus" | "canvas";
  /** The current frame: what Focus fits and the arrows step from; null is the Output. */
  focusedFrameId: FrameId | null;
  /** Counts the times a move left Focus mode, for the pill to show it; not persisted. */
  modeFlips: number;
  /** Width and height step of the loaded model; not persisted. */
  sizeMultiple: number;
  /** A frame to bring into view in canvas mode, counted per request; not persisted. */
  reveal: { frameId: string; n: number } | null;
  /** The canvas is wide enough for the minimap beside the bottom chrome; not persisted. */
  minimapRoom: boolean;

  setViewport: (viewport: Partial<ViewportState>) => void;
  requestReveal: (frameId: string) => void;
  setCanvasMode: (mode: "focus" | "canvas") => void;
  setFocusedFrame: (id: FrameId) => void;
  /** A move left Focus mode. */
  flipToCanvasMode: () => void;
  setActiveTool: (tool: ToolType) => void;
  setBrushSize: (size: number) => void;
  setMaskVisible: (visible: boolean) => void;
  setMaskColor: (color: string) => void;
  setEditingFrame: (frameId: string | null) => void;
  setPeekingFrame: (frameId: string | null) => void;
  setGestureFrame: (frameId: string | null) => void;
  togglePanelCollapsed: (key: string, currentCollapsed: boolean) => void;
  setSizeMultiple: (multiple: number) => void;
  setMinimapRoom: (room: boolean) => void;
}

/** The camera is not kept: every load fits the view afresh. */
interface PersistedCanvasState {
  activeTool: ToolType;
  brushSize: number;
  maskVisible: boolean;
  maskColor: string;
  panelCollapsedOverrides: [string, boolean][];
  canvasMode: "focus" | "canvas";
  focusedFrameId: FrameId | null;
}

const canvasRecords = idbBackend(DB.canvas, STATE_STORE);

const canvasStorage = createGatedStorage<PersistedCanvasState>(canvasRecords, "enso-canvas/state", {
  ...writeProblems("canvas", "canvas view", () => canvasStorage.retry()),
  // The record is rebuilt on every change to the store, the camera's included
  same: (a, b) => JSON.stringify(a) === JSON.stringify(b),
});

export const useCanvasStore = create<CanvasState>()(
  persist(
    (set) => ({
      viewport: { x: 0, y: 0, scale: 1 },
      activeTool: "move",
      brushSize: 20,
      maskVisible: true,
      maskColor: "#ff000080",
      editingFrameId: null,
      peekingFrameId: null,
      gestureFrameId: null,
      panelCollapsedOverrides: new Map<string, boolean>(),
      canvasMode: "canvas",
      focusedFrameId: null,
      modeFlips: 0,
      sizeMultiple: DEFAULT_SIZE_MULTIPLE,
      reveal: null,
      minimapRoom: true,

      requestReveal: (frameId) => set((s) => ({ reveal: { frameId, n: (s.reveal?.n ?? 0) + 1 } })),
      setCanvasMode: (mode) =>
        set((s) => ({
          canvasMode: mode,
          focusedFrameId: mode === "focus" && !s.focusedFrameId ? "output" : s.focusedFrameId,
        })),
      setFocusedFrame: (id) => set({ focusedFrameId: id }),
      flipToCanvasMode: () =>
        set((s) =>
          s.canvasMode === "canvas" ? s : { canvasMode: "canvas", modeFlips: s.modeFlips + 1 },
        ),
      setViewport: (viewport) => set((s) => ({ viewport: { ...s.viewport, ...viewport } })),

      setActiveTool: (tool) => set({ activeTool: tool }),
      setBrushSize: (size) => set({ brushSize: size }),
      setMaskVisible: (visible) => set({ maskVisible: visible }),
      setMaskColor: (color) => set({ maskColor: color }),
      setEditingFrame: (frameId) =>
        set((s) => (s.editingFrameId === frameId ? s : { editingFrameId: frameId })),
      setPeekingFrame: (frameId) =>
        set((s) => (s.peekingFrameId === frameId ? s : { peekingFrameId: frameId })),
      setGestureFrame: (frameId) =>
        set((s) => (s.gestureFrameId === frameId ? s : { gestureFrameId: frameId })),
      setSizeMultiple: (multiple) => set({ sizeMultiple: multiple }),
      setMinimapRoom: (room) => set((s) => (s.minimapRoom === room ? s : { minimapRoom: room })),

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
      name: RECORD.canvas,
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
        activeTool: state.activeTool,
        brushSize: state.brushSize,
        maskVisible: state.maskVisible,
        maskColor: state.maskColor,
        panelCollapsedOverrides: [...state.panelCollapsedOverrides.entries()],
        canvasMode: state.canvasMode,
        focusedFrameId: state.focusedFrameId,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<PersistedCanvasState> | undefined;
        if (!saved) return current;
        // Focus on nothing was the first-run state of older builds, which left
        // the Input off-screen: those open on everything
        const focus = saved.canvasMode === "focus" && saved.focusedFrameId != null;
        return {
          ...current,
          activeTool:
            saved.activeTool && TOOLS.includes(saved.activeTool)
              ? saved.activeTool
              : current.activeTool,
          brushSize: saved.brushSize ?? current.brushSize,
          maskVisible: saved.maskVisible ?? current.maskVisible,
          maskColor: saved.maskColor ?? current.maskColor,
          panelCollapsedOverrides: saved.panelCollapsedOverrides
            ? new Map(saved.panelCollapsedOverrides)
            : current.panelCollapsedOverrides,
          canvasMode: focus ? "focus" : "canvas",
          focusedFrameId: saved.focusedFrameId ?? null,
        };
      },
    },
  ),
);
