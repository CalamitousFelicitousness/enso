import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useGenerationStore } from "@/stores/generationStore";
import { useUiStore } from "@/stores/uiStore";
import { base64ToBlob } from "@/lib/utils";
import { createIdbStorage } from "@/lib/idbStorage";
import type { FrameId } from "@/canvas/frameList";

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

export interface CanvasLayer {
  id: string;
  type: "image" | "drawing" | "mask" | "generation";
  visible: boolean;
  opacity: number;
  locked: boolean;
  name: string;
}

export interface ImageLayer extends CanvasLayer {
  type: "image";
  imageData: string; // object URL for Konva display
  base64: string; // raw base64 for flattening / API
  file: File; // original File object
  naturalWidth: number; // original image pixel width
  naturalHeight: number; // original image pixel height
  x: number;
  y: number;
  width: number; // = naturalWidth (display reference)
  height: number; // = naturalHeight (display reference)
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export interface MaskObjectLayer extends CanvasLayer {
  type: "mask";
  imageData: string; // object URL of colored display image
  base64: string; // colored PNG base64 for persistence
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

/** One ordered entry in the Reference filmstrip - sibling concept to ImageLayer.
 * Used in Reference mode to model a set of input images sent to multi-image
 * cloud workflows (Nano Banana, Seedream multi-ref, etc.). Order in the array
 * is wire order. Separate from `layers` because the filmstrip's semantic is
 * "ordered list of independent images" not "composited scene graph." */
export interface ReferenceInput {
  id: string;
  imageData: string; // object URL for display
  base64: string; // raw base64 for persistence + flatten fallback
  file: File; // original File object for raw upload via uploadFile()
  naturalWidth: number;
  naturalHeight: number;
  filename: string;
}

interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

interface CanvasState {
  viewport: ViewportState;
  layers: CanvasLayer[];
  activeLayerId: string | null;
  activeTool: ToolType;
  brushSize: number;
  brushHardness: number;
  brushColor: string;
  brushOpacity: number;
  selection: { x: number; y: number; width: number; height: number } | null;
  maskVisible: boolean;
  maskColor: string;
  inputRole: "initial" | "reference";
  selectedControlFrame: number | null;
  panelCollapsedOverrides: Map<number, boolean>; // explicit user overrides
  canvasMode: "focus" | "canvas";
  focusedFrameId: FrameId | null;
  focusFitTrigger: number;
  modeLocked: boolean;
  /** Ordered list of reference images for multi-image cloud workflows.
   * Index in the array is wire order. Used in Reference mode in place of
   * the layer-stack-flatten path. Persisted to IndexedDB. */
  referenceInputs: ReferenceInput[];
  /** Ephemeral drag state for the filmstrip. Not persisted. */
  draggingReferenceId: string | null;
  dropTargetReferenceId: string | null;
  dropInsertIndex: number | null;

  setInputRole: (role: "initial" | "reference") => void;
  appendReferenceInput: (
    file: File,
    base64: string,
    objectUrl: string,
    w: number,
    h: number,
  ) => void;
  replaceReferenceInput: (
    id: string,
    file: File,
    base64: string,
    objectUrl: string,
    w: number,
    h: number,
  ) => void;
  removeReferenceInput: (id: string) => void;
  reorderReferenceInput: (fromIndex: number, toIndex: number) => void;
  setDraggingReference: (id: string | null) => void;
  setDropTargetReference: (id: string | null) => void;
  setDropInsertIndex: (index: number | null) => void;
  clearReferenceInputs: () => void;
  setViewport: (viewport: Partial<ViewportState>) => void;
  setCanvasMode: (mode: "focus" | "canvas") => void;
  setFocusedFrame: (id: FrameId) => void;
  switchToCanvasMode: () => void;
  bumpFocusFitTrigger: () => void;
  setModeLocked: (locked: boolean) => void;
  addLayer: (layer: CanvasLayer) => void;
  addImageLayer: (file: File, base64: string, objectUrl: string, w: number, h: number) => void;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, updates: Partial<CanvasLayer>) => void;
  setActiveLayer: (id: string | null) => void;
  setActiveTool: (tool: ToolType) => void;
  setBrushSize: (size: number) => void;
  setBrushColor: (color: string) => void;
  setBrushOpacity: (opacity: number) => void;
  setSelection: (rect: CanvasState["selection"]) => void;
  setMaskVisible: (visible: boolean) => void;
  setMaskColor: (color: string) => void;
  setSelectedControlFrame: (index: number | null) => void;
  togglePanelCollapsed: (index: number, currentCollapsed: boolean) => void;
  clearLayers: () => void;
  restoreImageLayer: (base64: string, w: number, h: number) => void;
  getImageLayers: () => ImageLayer[];
  getMaskLayers: () => MaskObjectLayer[];
  replaceMaskLayers: (newLayers: MaskObjectLayer[]) => void;
  removeMaskLayers: () => void;
}

/** Serializable snapshot of canvas state stored in IndexedDB. */
interface PersistedCanvasState {
  viewport: ViewportState;
  layers: CanvasLayer[];
  activeLayerId: string | null;
  activeTool: ToolType;
  inputRole: "initial" | "reference";
  brushSize: number;
  brushHardness: number;
  brushColor: string;
  brushOpacity: number;
  maskVisible: boolean;
  maskColor: string;
  panelCollapsedOverrides: [number, boolean][];
  canvasMode: "focus" | "canvas";
  focusedFrameId: FrameId | null;
  modeLocked: boolean;
  referenceInputs: ReferenceInput[];
}

const canvasIdbStorage = createIdbStorage("enso-canvas", "state");

function rehydrateLayer(layer: CanvasLayer): CanvasLayer | ImageLayer | MaskObjectLayer {
  if (layer.type === "image") {
    const img = layer as ImageLayer;
    if (!img.base64) return layer;
    const blob = base64ToBlob(img.base64);
    return {
      ...img,
      imageData: URL.createObjectURL(blob),
      file: new File([blob], img.name || "restored.png", { type: "image/png" }),
    };
  }
  if (layer.type === "mask") {
    const ml = layer as MaskObjectLayer;
    if (!ml.base64) return layer;
    const blob = base64ToBlob(ml.base64);
    return { ...ml, imageData: URL.createObjectURL(blob) };
  }
  return layer;
}

/** Reconstruct a ReferenceInput's File + object URL from persisted base64.
 * Mirrors rehydrateLayer for the image-layer case. */
function rehydrateReferenceInput(ref: ReferenceInput): ReferenceInput {
  if (!ref.base64) return ref;
  const blob = base64ToBlob(ref.base64);
  return {
    ...ref,
    imageData: URL.createObjectURL(blob),
    file: new File([blob], ref.filename || "reference.png", { type: "image/png" }),
  };
}

export const useCanvasStore = create<CanvasState>()(
  persist(
    (set, get) => ({
      viewport: { x: 0, y: 0, scale: 1 },
      layers: [],
      activeLayerId: null,
      activeTool: "move",
      brushSize: 20,
      brushHardness: 0.8,
      brushColor: "#ffffff",
      brushOpacity: 1,
      selection: null,
      maskVisible: true,
      maskColor: "#ff000080",
      inputRole: "initial",
      selectedControlFrame: null,
      panelCollapsedOverrides: new Map<number, boolean>(),
      canvasMode: "focus",
      focusedFrameId: null,
      focusFitTrigger: 0,
      modeLocked: false,
      referenceInputs: [],
      draggingReferenceId: null,
      dropTargetReferenceId: null,
      dropInsertIndex: null,

      setInputRole: (role) =>
        set((s) => {
          // Auto-migrate the user's current canvas image into referenceInputs
          // the first time they enter Reference mode with a populated layer
          // stack but an empty filmstrip. Picks the first visible ImageLayer
          // so the wire order matches "the image I had in front of me." The
          // original layer stays in `layers` - both representations coexist
          // and the layer is what the user sees if they toggle back to
          // Initial. A fresh objectUrl is created for the reference so
          // removeReferenceInput can safely revokeObjectURL without
          // affecting the layer's display.
          if (role === "reference" && s.referenceInputs.length === 0) {
            const firstImage = s.layers.find(
              (l): l is ImageLayer => l.type === "image" && l.visible,
            );
            if (firstImage) {
              const seedRef: ReferenceInput = {
                id: crypto.randomUUID(),
                file: firstImage.file,
                base64: firstImage.base64,
                imageData: URL.createObjectURL(firstImage.file),
                naturalWidth: firstImage.naturalWidth,
                naturalHeight: firstImage.naturalHeight,
                filename: firstImage.name || firstImage.file.name || "image.png",
              };
              return { inputRole: role, referenceInputs: [seedRef] };
            }
          }
          return { inputRole: role };
        }),

      appendReferenceInput: (file, base64, objectUrl, w, h) => {
        const ref: ReferenceInput = {
          id: crypto.randomUUID(),
          file,
          base64,
          imageData: objectUrl,
          naturalWidth: w,
          naturalHeight: h,
          filename: file.name,
        };
        set((s) => ({ referenceInputs: [...s.referenceInputs, ref] }));
      },

      replaceReferenceInput: (id, file, base64, objectUrl, w, h) => {
        set((s) => ({
          referenceInputs: s.referenceInputs.map((ref) => {
            if (ref.id !== id) return ref;
            URL.revokeObjectURL(ref.imageData);
            return {
              ...ref,
              file,
              base64,
              imageData: objectUrl,
              naturalWidth: w,
              naturalHeight: h,
              filename: file.name,
            };
          }),
        }));
      },

      removeReferenceInput: (id) => {
        set((s) => {
          const target = s.referenceInputs.find((r) => r.id === id);
          if (target) URL.revokeObjectURL(target.imageData);
          return {
            referenceInputs: s.referenceInputs.filter((r) => r.id !== id),
            draggingReferenceId: s.draggingReferenceId === id ? null : s.draggingReferenceId,
            dropTargetReferenceId: s.dropTargetReferenceId === id ? null : s.dropTargetReferenceId,
          };
        });
      },

      reorderReferenceInput: (fromIndex, toIndex) => {
        set((s) => {
          const next = s.referenceInputs.slice();
          if (
            fromIndex < 0 ||
            fromIndex >= next.length ||
            toIndex < 0 ||
            toIndex > next.length ||
            fromIndex === toIndex
          ) {
            return s;
          }
          const [moved] = next.splice(fromIndex, 1);
          // toIndex was computed before the splice; account for the shift when
          // moving forward in the array.
          const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex;
          next.splice(insertAt, 0, moved);
          return { referenceInputs: next };
        });
      },

      setDraggingReference: (id) => set({ draggingReferenceId: id }),
      setDropTargetReference: (id) => set({ dropTargetReferenceId: id }),
      setDropInsertIndex: (index) => set({ dropInsertIndex: index }),

      clearReferenceInputs: () => {
        const { referenceInputs } = get();
        for (const ref of referenceInputs) URL.revokeObjectURL(ref.imageData);
        set({
          referenceInputs: [],
          draggingReferenceId: null,
          dropTargetReferenceId: null,
          dropInsertIndex: null,
        });
      },
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

      addLayer: (layer) => set((s) => ({ layers: [...s.layers, layer] })),

      addImageLayer: (file, base64, objectUrl, w, h) => {
        const gen = useGenerationStore.getState();
        const { layers } = get();

        // Auto-resize frame to match first image (snap to 8px grid)
        const autoFit = useUiStore.getState().autoFitFrame;
        if (layers.length === 0 && autoFit) {
          const snapW = Math.round(w / 8) * 8;
          const snapH = Math.round(h / 8) * 8;
          gen.setParam("width", snapW);
          gen.setParam("height", snapH);
        }

        // Use (potentially just-updated) frame dimensions for centering
        const frameW = layers.length === 0 && autoFit ? Math.round(w / 8) * 8 : gen.width;
        const frameH = layers.length === 0 && autoFit ? Math.round(h / 8) * 8 : gen.height;

        const id = crypto.randomUUID();
        const layer: ImageLayer = {
          id,
          type: "image",
          name: file.name,
          visible: true,
          opacity: 1,
          locked: false,
          imageData: objectUrl,
          base64,
          file,
          naturalWidth: w,
          naturalHeight: h,
          x: Math.round((frameW - w) / 2),
          y: Math.round((frameH - h) / 2),
          width: w,
          height: h,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
        };
        set((s) => ({ layers: [...s.layers, layer], activeLayerId: id }));
      },

      removeLayer: (id) =>
        set((s) => {
          const layer = s.layers.find((l) => l.id === id);
          if (layer && (layer.type === "image" || layer.type === "mask")) {
            URL.revokeObjectURL((layer as ImageLayer | MaskObjectLayer).imageData);
          }
          return {
            layers: s.layers.filter((l) => l.id !== id),
            activeLayerId: s.activeLayerId === id ? null : s.activeLayerId,
          };
        }),

      updateLayer: (id, updates) =>
        set((s) => ({
          layers: s.layers.map((l) => (l.id === id ? { ...l, ...updates } : l)),
        })),

      setActiveLayer: (id) => set({ activeLayerId: id }),
      setActiveTool: (tool) => set({ activeTool: tool }),
      setBrushSize: (size) => set({ brushSize: size }),
      setBrushColor: (color) => set({ brushColor: color }),
      setBrushOpacity: (opacity) => set({ brushOpacity: opacity }),
      setSelection: (rect) => set({ selection: rect }),
      setMaskVisible: (visible) => set({ maskVisible: visible }),
      setMaskColor: (color) => set({ maskColor: color }),
      setSelectedControlFrame: (index) => set({ selectedControlFrame: index }),

      togglePanelCollapsed: (index, currentCollapsed: boolean) =>
        set((s) => {
          const newMap = new Map(s.panelCollapsedOverrides);
          newMap.set(index, !currentCollapsed);
          return { panelCollapsedOverrides: newMap };
        }),

      clearLayers: () => {
        const { layers } = get();
        for (const layer of layers) {
          if (layer.type === "image" || layer.type === "mask") {
            URL.revokeObjectURL((layer as ImageLayer | MaskObjectLayer).imageData);
          }
        }
        set({ layers: [], activeLayerId: null });
      },

      restoreImageLayer: (base64, w, h) => {
        // Clear existing layers first
        const { layers } = get();
        for (const layer of layers) {
          if (layer.type === "image") {
            URL.revokeObjectURL((layer as ImageLayer).imageData);
          }
        }
        const blob = base64ToBlob(base64);
        const objectUrl = URL.createObjectURL(blob);
        const id = crypto.randomUUID();
        const layer: ImageLayer = {
          id,
          type: "image",
          name: "Restored input",
          visible: true,
          opacity: 1,
          locked: false,
          imageData: objectUrl,
          base64,
          file: new File([blob], "restored.png", { type: "image/png" }),
          naturalWidth: w,
          naturalHeight: h,
          x: 0,
          y: 0,
          width: w,
          height: h,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
        };
        set({ layers: [layer], activeLayerId: id });
      },

      getImageLayers: () => get().layers.filter((l) => l.type === "image") as ImageLayer[],

      getMaskLayers: () => get().layers.filter((l) => l.type === "mask") as MaskObjectLayer[],

      replaceMaskLayers: (newLayers) => {
        const { layers } = get();
        for (const l of layers) {
          if (l.type === "mask") URL.revokeObjectURL((l as MaskObjectLayer).imageData);
        }
        set((s) => ({
          layers: [...s.layers.filter((l) => l.type !== "mask"), ...newLayers],
        }));
      },

      removeMaskLayers: () => {
        const { layers } = get();
        for (const l of layers) {
          if (l.type === "mask") URL.revokeObjectURL((l as MaskObjectLayer).imageData);
        }
        set((s) => ({
          layers: s.layers.filter((l) => l.type !== "mask"),
          activeLayerId:
            s.activeLayerId && s.layers.find((l) => l.id === s.activeLayerId)?.type === "mask"
              ? null
              : s.activeLayerId,
        }));
      },
    }),
    {
      name: "enso-canvas",
      storage: createJSONStorage(() => canvasIdbStorage),
      partialize: (state): PersistedCanvasState => ({
        viewport: state.viewport,
        inputRole: state.inputRole,
        layers: state.layers.map((layer) => {
          if (layer.type === "image") {
            const { file: _file, imageData: _url, ...rest } = layer as ImageLayer;
            return { ...rest, imageData: "", file: undefined } as unknown as CanvasLayer;
          }
          if (layer.type === "mask") {
            const { imageData: _url, ...rest } = layer as MaskObjectLayer;
            return { ...rest, imageData: "" } as unknown as CanvasLayer;
          }
          return layer;
        }),
        activeLayerId: state.activeLayerId,
        activeTool: state.activeTool,
        brushSize: state.brushSize,
        brushHardness: state.brushHardness,
        brushColor: state.brushColor,
        brushOpacity: state.brushOpacity,
        maskVisible: state.maskVisible,
        maskColor: state.maskColor,
        panelCollapsedOverrides: [...state.panelCollapsedOverrides.entries()],
        canvasMode: state.canvasMode,
        focusedFrameId: state.focusedFrameId,
        modeLocked: state.modeLocked,
        referenceInputs: state.referenceInputs.map((ref) => {
          // Strip File + object URL for storage; base64 + dims + filename
          // are enough to rehydrate on next load.
          const { file: _file, imageData: _url, ...rest } = ref;
          return { ...rest, imageData: "", file: undefined } as unknown as ReferenceInput;
        }),
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<PersistedCanvasState> | undefined;
        if (!saved) return current;
        return {
          ...current,
          viewport: saved.viewport ?? current.viewport,
          activeLayerId: saved.activeLayerId ?? current.activeLayerId,
          activeTool: saved.activeTool ?? current.activeTool,
          inputRole: saved.inputRole ?? "initial",
          brushSize: saved.brushSize ?? current.brushSize,
          brushHardness: saved.brushHardness ?? current.brushHardness,
          brushColor: saved.brushColor ?? current.brushColor,
          brushOpacity: saved.brushOpacity ?? current.brushOpacity,
          maskVisible: saved.maskVisible ?? current.maskVisible,
          maskColor: saved.maskColor ?? current.maskColor,
          panelCollapsedOverrides: saved.panelCollapsedOverrides
            ? new Map(saved.panelCollapsedOverrides)
            : current.panelCollapsedOverrides,
          canvasMode: saved.canvasMode ?? "focus",
          focusedFrameId: saved.focusedFrameId ?? null,
          modeLocked: saved.modeLocked ?? false,
          layers: saved.layers ? saved.layers.map(rehydrateLayer) : current.layers,
          referenceInputs: saved.referenceInputs
            ? saved.referenceInputs.map(rehydrateReferenceInput)
            : current.referenceInputs,
        };
      },
    },
  ),
);
