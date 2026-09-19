import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useGenerationStore } from "@/stores/generationStore";
import { useUiStore } from "@/stores/uiStore";
import { base64ToBlob } from "@/lib/utils";
import { createIdbStorage } from "@/lib/idbStorage";
import { createInitialFrame, createReferenceFrame } from "@/canvas/inputFrames";
import type { FrameId } from "@/canvas/frameList";
import type { InputFrame, InputFrameMode } from "@/canvas/inputFrames";
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
  file: File; // image bytes; persisted, flattened and uploaded from
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
  imageData: string; // object URL of blob, for the LayerPanel thumbnail
  blob: Blob; // tinted PNG; persisted, displayed and rebaked from
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
  file: File; // image bytes; persisted and uploaded raw via uploadFile()
  naturalWidth: number;
  naturalHeight: number;
  filename: string;
}

/** One mask paint stroke. Owned by an Initial-mode InputFrame's
 * `maskLines` array; sourced by exportMask() at submit time to produce the
 * baked mask sent to the backend. Was on img2imgStore prior to the
 * multi-Input-frame refactor; the type definition lives here now
 * so per-frame mask state can be expressed without crossing stores. */
export interface MaskLine {
  points: number[]; // flat [x1,y1,x2,y2,...] in image-space pixels
  strokeWidth: number;
  tool: "brush" | "eraser";
}

/** Ephemeral drag state for one Reference frame's filmstrip. Lives on
 * canvasStore.filmstripDrag keyed by frameId so a drag inside one mother
 * frame doesn't bleed visual state into another. NOT persisted. */
export interface FilmstripDragState {
  draggingReferenceId: string | null;
  dropTargetReferenceId: string | null;
  dropInsertIndex: number | null;
}

interface CanvasState {
  viewport: ViewportState;
  activeTool: ToolType;
  brushSize: number;
  brushHardness: number;
  brushColor: string;
  brushOpacity: number;
  selection: { x: number; y: number; width: number; height: number } | null;
  maskVisible: boolean;
  maskColor: string;
  selectedControlFrame: number | null;
  /** Per-panel collapse override map, keyed by FrameId string. Keys take
   * the form `input:${uuid}` for Input frames, `"output"` for the Output
   * panel, and `\`control:${unitIndex}\`` for ControlNet units. */
  panelCollapsedOverrides: Map<string, boolean>;
  canvasMode: "focus" | "canvas";
  focusedFrameId: FrameId | null;
  focusFitTrigger: number;
  modeLocked: boolean;

  setViewport: (viewport: Partial<ViewportState>) => void;
  setCanvasMode: (mode: "focus" | "canvas") => void;
  setFocusedFrame: (id: FrameId) => void;
  switchToCanvasMode: () => void;
  bumpFocusFitTrigger: () => void;
  setModeLocked: (locked: boolean) => void;
  setActiveTool: (tool: ToolType) => void;
  setBrushSize: (size: number) => void;
  setBrushColor: (color: string) => void;
  setBrushOpacity: (opacity: number) => void;
  setSelection: (rect: CanvasState["selection"]) => void;
  setMaskVisible: (visible: boolean) => void;
  setMaskColor: (color: string) => void;
  setSelectedControlFrame: (index: number | null) => void;
  togglePanelCollapsed: (key: string, currentCollapsed: boolean) => void;

  // ── Per-Input-frame state ────────────────────────────────────────────
  // The multi-Input-frame surface. Each frame carries its own layers,
  // activeLayerId, mask state, and references. Mutations are scoped per
  // frame; there is no global "current layer" or "current mask" concept.

  inputFrames: InputFrame[];
  activeInputFrameId: string | null;
  filmstripDrag: Map<string, FilmstripDragState>;
  inputFrameDrag: { fromIndex: number; toIndex: number | null } | null;

  // Frame lifecycle
  addInputFrame: (opts?: { mode?: InputFrameMode; position?: "end" | "start" | number }) => string;
  removeInputFrame: (frameId: string) => void;
  reorderInputFrames: (fromIndex: number, toIndex: number) => void;
  setActiveInputFrame: (frameId: string | null) => void;
  setFrameMode: (frameId: string, mode: InputFrameMode) => void;

  // Per-frame layer mutations
  addImageLayerToFrame: (
    frameId: string,
    file: File,
    objectUrl: string,
    w: number,
    h: number,
  ) => void;
  addLayerToFrame: (frameId: string, layer: CanvasLayer) => void;
  removeLayerFromFrame: (frameId: string, layerId: string) => void;
  updateLayerInFrame: (frameId: string, layerId: string, updates: Partial<CanvasLayer>) => void;
  setActiveLayerInFrame: (frameId: string, layerId: string | null) => void;
  clearLayersInFrame: (frameId: string) => void;
  restoreImageLayerToFrame: (frameId: string, blob: Blob, w: number, h: number) => void;
  getImageLayersInFrame: (frameId: string) => ImageLayer[];
  getMaskLayersInFrame: (frameId: string) => MaskObjectLayer[];
  replaceMaskLayersInFrame: (frameId: string, newLayers: MaskObjectLayer[]) => void;
  removeMaskLayersInFrame: (frameId: string) => void;

  // Per-frame reference filmstrip mutations
  appendReferenceToFrame: (
    frameId: string,
    file: File,
    objectUrl: string,
    w: number,
    h: number,
  ) => void;
  removeReferenceFromFrame: (frameId: string, refId: string) => void;
  reorderReferenceInFrame: (frameId: string, fromIndex: number, toIndex: number) => void;
  clearReferencesInFrame: (frameId: string) => void;

  // Per-frame filmstrip drag state
  setDraggingReferenceInFrame: (frameId: string, refId: string | null) => void;
  setDropTargetReferenceInFrame: (frameId: string, refId: string | null) => void;
  setDropInsertIndexInFrame: (frameId: string, index: number | null) => void;

  // Per-frame mask state
  addMaskLineToFrame: (frameId: string, line: MaskLine) => void;
  clearMaskLinesInFrame: (frameId: string) => void;

  // Whole-frame drag (vertical reorder of the input column)
  setInputFrameDrag: (drag: { fromIndex: number; toIndex: number | null } | null) => void;

  // Selectors
  getActiveInitialFrame: () => InputFrame | null;
  getInputFrame: (frameId: string) => InputFrame | undefined;
}

/** Field-by-field projections for IndexedDB. Image bytes travel as File and
 * Blob (structured clone copies the handle, not the bytes); object URLs are
 * recreated on rehydrate. */
interface PersistedImageLayer {
  id: string;
  type: "image";
  name: string;
  visible: boolean;
  opacity: number;
  locked: boolean;
  file: File;
  naturalWidth: number;
  naturalHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

interface PersistedMaskLayer {
  id: string;
  type: "mask";
  name: string;
  visible: boolean;
  opacity: number;
  locked: boolean;
  blob: Blob;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

type PersistedLayer = PersistedImageLayer | PersistedMaskLayer;

interface PersistedReference {
  id: string;
  file: File;
  naturalWidth: number;
  naturalHeight: number;
  filename: string;
}

interface PersistedInputFrame {
  id: string;
  mode: InputFrameMode;
  layers: PersistedLayer[];
  activeLayerId: string | null;
  maskLines: MaskLine[];
  references: PersistedReference[];
}

/** Serializable snapshot of canvas state stored in IndexedDB. The v2 shape
 * after - legacy singular fields (layers, activeLayerId,
 * inputRole, referenceInputs) retire here; all input-side content lives
 * inside inputFrames. */
interface PersistedCanvasState {
  viewport: ViewportState;
  activeTool: ToolType;
  brushSize: number;
  brushHardness: number;
  brushColor: string;
  brushOpacity: number;
  maskVisible: boolean;
  maskColor: string;
  panelCollapsedOverrides: [string, boolean][];
  canvasMode: "focus" | "canvas";
  focusedFrameId: FrameId | null;
  modeLocked: boolean;
  inputFrames: PersistedInputFrame[];
  activeInputFrameId: string | null;
}

const canvasIdbStorage = createIdbStorage<PersistedCanvasState>("enso-canvas", "state", {
  legacyKey: "enso-canvas",
});

function rehydrateLayer(saved: PersistedLayer): ImageLayer | MaskObjectLayer {
  if (saved.type === "image") return { ...saved, imageData: URL.createObjectURL(saved.file) };
  return { ...saved, imageData: URL.createObjectURL(saved.blob) };
}

function rehydrateReferenceInput(saved: PersistedReference): ReferenceInput {
  return { ...saved, imageData: URL.createObjectURL(saved.file) };
}

/** Explicit field lists: anything else on a layer (object URLs, future
 * runtime-only handles) must not reach structured clone. */
function stripLayerForPersist(layer: CanvasLayer): PersistedLayer | null {
  if (layer.type === "image") {
    const l = layer as ImageLayer;
    return {
      id: l.id,
      type: "image",
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      locked: l.locked,
      file: l.file,
      naturalWidth: l.naturalWidth,
      naturalHeight: l.naturalHeight,
      x: l.x,
      y: l.y,
      width: l.width,
      height: l.height,
      rotation: l.rotation,
      scaleX: l.scaleX,
      scaleY: l.scaleY,
    };
  }
  if (layer.type === "mask") {
    const l = layer as MaskObjectLayer;
    return {
      id: l.id,
      type: "mask",
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      locked: l.locked,
      blob: l.blob,
      x: l.x,
      y: l.y,
      width: l.width,
      height: l.height,
      scaleX: l.scaleX,
      scaleY: l.scaleY,
      rotation: l.rotation,
    };
  }
  return null;
}

function stripReferenceInputForPersist(ref: ReferenceInput): PersistedReference {
  return {
    id: ref.id,
    file: ref.file,
    naturalWidth: ref.naturalWidth,
    naturalHeight: ref.naturalHeight,
    filename: ref.filename,
  };
}

/** Record shapes before version 4, when image bytes were stored as base64. */
type LegacyImageLayer = Omit<ImageLayer, "file" | "imageData"> & { base64?: string };
type LegacyMaskLayer = Omit<MaskObjectLayer, "blob" | "imageData"> & { base64?: string };
type LegacyReference = Omit<ReferenceInput, "file" | "imageData"> & { base64?: string };

interface LegacyPersistedInputFrame {
  id: string;
  mode: InputFrameMode;
  layers?: CanvasLayer[];
  activeLayerId?: string | null;
  maskLines?: MaskLine[];
  references?: LegacyReference[];
}

type LegacyPersistedCanvasState = Omit<PersistedCanvasState, "inputFrames"> & {
  inputFrames?: LegacyPersistedInputFrame[];
};

function migrateLayerV3(layer: CanvasLayer): PersistedLayer | null {
  if (layer.type === "image") {
    const l = layer as LegacyImageLayer;
    if (!l.base64) return null;
    return {
      id: l.id,
      type: "image",
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      locked: l.locked,
      file: new File([base64ToBlob(l.base64)], l.name || "restored.png", { type: "image/png" }),
      naturalWidth: l.naturalWidth,
      naturalHeight: l.naturalHeight,
      x: l.x,
      y: l.y,
      width: l.width,
      height: l.height,
      rotation: l.rotation,
      scaleX: l.scaleX,
      scaleY: l.scaleY,
    };
  }
  if (layer.type === "mask") {
    const l = layer as LegacyMaskLayer;
    if (!l.base64) return null;
    return {
      id: l.id,
      type: "mask",
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      locked: l.locked,
      blob: base64ToBlob(l.base64),
      x: l.x,
      y: l.y,
      width: l.width,
      height: l.height,
      scaleX: l.scaleX,
      scaleY: l.scaleY,
      rotation: l.rotation,
    };
  }
  return null;
}

function migrateReferenceV3(ref: LegacyReference): PersistedReference | null {
  if (!ref.base64) return null;
  const filename = ref.filename || "reference.png";
  return {
    id: ref.id,
    file: new File([base64ToBlob(ref.base64)], filename, { type: "image/png" }),
    naturalWidth: ref.naturalWidth,
    naturalHeight: ref.naturalHeight,
    filename,
  };
}

function migrateV3(legacy: LegacyPersistedCanvasState): PersistedCanvasState {
  const { inputFrames, ...rest } = legacy;
  return {
    ...rest,
    inputFrames: (inputFrames ?? []).map((frame) => ({
      id: frame.id,
      mode: frame.mode,
      layers: (frame.layers ?? []).map(migrateLayerV3).filter(Boolean),
      activeLayerId: frame.activeLayerId ?? null,
      maskLines: frame.maskLines ?? [],
      references: (frame.references ?? []).map(migrateReferenceV3).filter(Boolean),
    })),
  };
}

// merge() reads every field with a fallback, so an empty record hydrates
// the defaults.
const EMPTY_RECORD = {} as PersistedCanvasState;

/** Apply a transform to one InputFrame in the array, returning a new slice
 * with the frame replaced. Returns the original array if frameId is not
 * found - mutations should be no-ops for unknown frames (defensive). */
function withFrame(
  frames: InputFrame[],
  frameId: string,
  transform: (frame: InputFrame) => InputFrame,
): InputFrame[] {
  const idx = frames.findIndex((f) => f.id === frameId);
  if (idx === -1) return frames;
  const next = frames.slice();
  next[idx] = transform(next[idx]);
  return next;
}

// Default seed frame for a fresh canvas. Lives at module scope so the
// (set, get) => ({...}) initializer can reference both [seedFrame] and
// seedFrame.id without needing a function-block return. On HMR re-eval a
// new UUID is generated, but persist.merge replaces it with the persisted
// state anyway; for the no-persistence path this id stays stable for the
// life of the page.
const seedFrame = createInitialFrame();

export const useCanvasStore = create<CanvasState>()(
  persist(
    (set, get) => ({
      viewport: { x: 0, y: 0, scale: 1 },
      activeTool: "move",
      brushSize: 20,
      brushHardness: 0.8,
      brushColor: "#ffffff",
      brushOpacity: 1,
      selection: null,
      maskVisible: true,
      maskColor: "#ff000080",
      selectedControlFrame: null,
      panelCollapsedOverrides: new Map<string, boolean>(),
      canvasMode: "focus",
      focusedFrameId: null,
      focusFitTrigger: 0,
      modeLocked: false,
      inputFrames: [seedFrame],
      activeInputFrameId: seedFrame.id,
      filmstripDrag: new Map<string, FilmstripDragState>(),
      inputFrameDrag: null,

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
      setBrushColor: (color) => set({ brushColor: color }),
      setBrushOpacity: (opacity) => set({ brushOpacity: opacity }),
      setSelection: (rect) => set({ selection: rect }),
      setMaskVisible: (visible) => set({ maskVisible: visible }),
      setMaskColor: (color) => set({ maskColor: color }),
      setSelectedControlFrame: (index) => set({ selectedControlFrame: index }),

      togglePanelCollapsed: (key, currentCollapsed: boolean) =>
        set((s) => {
          const newMap = new Map(s.panelCollapsedOverrides);
          newMap.set(key, !currentCollapsed);
          return { panelCollapsedOverrides: newMap };
        }),

      // ── Per-Input-frame mutations ─────────────────────────────────────

      addInputFrame: (opts = {}) => {
        const mode: InputFrameMode = opts.mode ?? "initial";
        const frame = mode === "initial" ? createInitialFrame() : createReferenceFrame();
        set((s) => {
          const next = s.inputFrames.slice();
          let insertAt: number;
          if (opts.position === "start") insertAt = 0;
          else if (opts.position === "end" || opts.position === undefined) insertAt = next.length;
          else insertAt = Math.max(0, Math.min(next.length, opts.position));
          next.splice(insertAt, 0, frame);
          return { inputFrames: next };
        });
        return frame.id;
      },

      removeInputFrame: (frameId) =>
        set((s) => {
          const idx = s.inputFrames.findIndex((f) => f.id === frameId);
          if (idx === -1) return s;
          const frame = s.inputFrames[idx];
          for (const layer of frame.layers) {
            if (layer.type === "image" || layer.type === "mask") {
              URL.revokeObjectURL((layer as ImageLayer | MaskObjectLayer).imageData);
            }
          }
          for (const ref of frame.references) URL.revokeObjectURL(ref.imageData);
          const next = s.inputFrames.filter((f) => f.id !== frameId);
          let nextActive = s.activeInputFrameId;
          if (s.activeInputFrameId === frameId) {
            nextActive = next.length > 0 ? next[Math.max(0, idx - 1)].id : null;
          }
          const nextDrag = new Map(s.filmstripDrag);
          nextDrag.delete(frameId);
          return {
            inputFrames: next,
            activeInputFrameId: nextActive,
            filmstripDrag: nextDrag,
          };
        }),

      reorderInputFrames: (fromIndex, toIndex) =>
        set((s) => {
          const next = s.inputFrames.slice();
          if (
            fromIndex < 0 ||
            fromIndex >= next.length ||
            toIndex < 0 ||
            toIndex >= next.length ||
            fromIndex === toIndex
          ) {
            return s;
          }
          const [moved] = next.splice(fromIndex, 1);
          next.splice(toIndex, 0, moved);
          return { inputFrames: next };
        }),

      setActiveInputFrame: (frameId) =>
        set((s) => (s.activeInputFrameId === frameId ? s : { activeInputFrameId: frameId })),

      setFrameMode: (frameId, mode) =>
        set((s) => {
          const frame = s.inputFrames.find((f) => f.id === frameId);
          if (!frame || frame.mode === mode) return s;
          // Auto-migrate the first visible image layer into references[0]
          // when entering Reference mode with an empty filmstrip - mirrors
          // the legacy setInputRole behavior. Layers stay so flipping back
          // to Initial restores the user's painting target. A fresh
          // objectUrl is created for the seeded ref so subsequent
          // removeReferenceFromFrame can revokeObjectURL safely without
          // affecting the layer's display.
          if (mode === "reference" && frame.references.length === 0) {
            const firstImage = frame.layers.find(
              (l): l is ImageLayer => l.type === "image" && l.visible,
            );
            if (firstImage) {
              const seedRef: ReferenceInput = {
                id: crypto.randomUUID(),
                file: firstImage.file,
                imageData: URL.createObjectURL(firstImage.file),
                naturalWidth: firstImage.naturalWidth,
                naturalHeight: firstImage.naturalHeight,
                filename: firstImage.name || firstImage.file.name || "image.png",
              };
              return {
                inputFrames: withFrame(s.inputFrames, frameId, (f) => ({
                  ...f,
                  mode,
                  references: [seedRef],
                  activeLayerId: null,
                })),
              };
            }
          }
          return {
            inputFrames: withFrame(s.inputFrames, frameId, (f) => ({
              ...f,
              mode,
              activeLayerId: mode === "reference" ? null : f.activeLayerId,
            })),
          };
        }),

      // Per-frame layer mutations

      addImageLayerToFrame: (frameId, file, objectUrl, w, h) => {
        const frame = get().inputFrames.find((f) => f.id === frameId);
        if (!frame) return;
        const gen = useGenerationStore.getState();
        const autoFit = useUiStore.getState().autoFitFrame;
        const isFirst = frame.layers.length === 0 && autoFit;
        if (isFirst) {
          const snapW = Math.round(w / 8) * 8;
          const snapH = Math.round(h / 8) * 8;
          gen.setParam("width", snapW);
          gen.setParam("height", snapH);
        }
        const frameW = isFirst ? Math.round(w / 8) * 8 : gen.width;
        const frameH = isFirst ? Math.round(h / 8) * 8 : gen.height;
        const id = crypto.randomUUID();
        const layer: ImageLayer = {
          id,
          type: "image",
          name: file.name,
          visible: true,
          opacity: 1,
          locked: false,
          imageData: objectUrl,
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
        set((s) => ({
          inputFrames: withFrame(s.inputFrames, frameId, (f) => ({
            ...f,
            layers: [...f.layers, layer],
            activeLayerId: id,
          })),
        }));
      },

      addLayerToFrame: (frameId, layer) =>
        set((s) => ({
          inputFrames: withFrame(s.inputFrames, frameId, (f) => ({
            ...f,
            layers: [...f.layers, layer],
          })),
        })),

      removeLayerFromFrame: (frameId, layerId) =>
        set((s) => {
          const frame = s.inputFrames.find((f) => f.id === frameId);
          if (!frame) return s;
          const layer = frame.layers.find((l) => l.id === layerId);
          if (layer && (layer.type === "image" || layer.type === "mask")) {
            URL.revokeObjectURL((layer as ImageLayer | MaskObjectLayer).imageData);
          }
          return {
            inputFrames: withFrame(s.inputFrames, frameId, (f) => ({
              ...f,
              layers: f.layers.filter((l) => l.id !== layerId),
              activeLayerId: f.activeLayerId === layerId ? null : f.activeLayerId,
            })),
          };
        }),

      updateLayerInFrame: (frameId, layerId, updates) =>
        set((s) => ({
          inputFrames: withFrame(s.inputFrames, frameId, (f) => ({
            ...f,
            layers: f.layers.map((l) => (l.id === layerId ? { ...l, ...updates } : l)),
          })),
        })),

      setActiveLayerInFrame: (frameId, layerId) =>
        set((s) => ({
          inputFrames: withFrame(s.inputFrames, frameId, (f) => ({
            ...f,
            activeLayerId: layerId,
          })),
        })),

      clearLayersInFrame: (frameId) =>
        set((s) => {
          const frame = s.inputFrames.find((f) => f.id === frameId);
          if (!frame) return s;
          for (const layer of frame.layers) {
            if (layer.type === "image" || layer.type === "mask") {
              URL.revokeObjectURL((layer as ImageLayer | MaskObjectLayer).imageData);
            }
          }
          return {
            inputFrames: withFrame(s.inputFrames, frameId, (f) => ({
              ...f,
              layers: [],
              activeLayerId: null,
            })),
          };
        }),

      restoreImageLayerToFrame: (frameId, blob, w, h) => {
        const frame = get().inputFrames.find((f) => f.id === frameId);
        if (!frame) return;
        for (const layer of frame.layers) {
          if (layer.type === "image") {
            URL.revokeObjectURL((layer as ImageLayer).imageData);
          }
        }
        const objectUrl = URL.createObjectURL(blob);
        const id = crypto.randomUUID();
        const newLayer: ImageLayer = {
          id,
          type: "image",
          name: "Restored input",
          visible: true,
          opacity: 1,
          locked: false,
          imageData: objectUrl,
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
        set((s) => ({
          inputFrames: withFrame(s.inputFrames, frameId, (f) => ({
            ...f,
            layers: [newLayer],
            activeLayerId: id,
          })),
        }));
      },

      getImageLayersInFrame: (frameId) => {
        const frame = get().inputFrames.find((f) => f.id === frameId);
        return frame ? (frame.layers.filter((l) => l.type === "image") as ImageLayer[]) : [];
      },

      getMaskLayersInFrame: (frameId) => {
        const frame = get().inputFrames.find((f) => f.id === frameId);
        return frame ? (frame.layers.filter((l) => l.type === "mask") as MaskObjectLayer[]) : [];
      },

      replaceMaskLayersInFrame: (frameId, newLayers) =>
        set((s) => {
          const frame = s.inputFrames.find((f) => f.id === frameId);
          if (!frame) return s;
          for (const l of frame.layers) {
            if (l.type === "mask") URL.revokeObjectURL((l as MaskObjectLayer).imageData);
          }
          return {
            inputFrames: withFrame(s.inputFrames, frameId, (f) => ({
              ...f,
              layers: [...f.layers.filter((l) => l.type !== "mask"), ...newLayers],
            })),
          };
        }),

      removeMaskLayersInFrame: (frameId) =>
        set((s) => {
          const frame = s.inputFrames.find((f) => f.id === frameId);
          if (!frame) return s;
          for (const l of frame.layers) {
            if (l.type === "mask") URL.revokeObjectURL((l as MaskObjectLayer).imageData);
          }
          return {
            inputFrames: withFrame(s.inputFrames, frameId, (f) => {
              const activeIsMask =
                f.activeLayerId !== null &&
                f.layers.find((l) => l.id === f.activeLayerId)?.type === "mask";
              return {
                ...f,
                layers: f.layers.filter((l) => l.type !== "mask"),
                activeLayerId: activeIsMask ? null : f.activeLayerId,
              };
            }),
          };
        }),

      // Per-frame reference filmstrip mutations

      appendReferenceToFrame: (frameId, file, objectUrl, w, h) => {
        const ref: ReferenceInput = {
          id: crypto.randomUUID(),
          file,
          imageData: objectUrl,
          naturalWidth: w,
          naturalHeight: h,
          filename: file.name,
        };
        set((s) => ({
          inputFrames: withFrame(s.inputFrames, frameId, (f) => ({
            ...f,
            references: [...f.references, ref],
          })),
        }));
      },

      removeReferenceFromFrame: (frameId, refId) =>
        set((s) => {
          const frame = s.inputFrames.find((f) => f.id === frameId);
          if (!frame) return s;
          const target = frame.references.find((r) => r.id === refId);
          if (target) URL.revokeObjectURL(target.imageData);
          // Clear any per-frame drag state pointing at the removed child.
          const nextDrag = new Map(s.filmstripDrag);
          const prev = nextDrag.get(frameId);
          if (prev) {
            nextDrag.set(frameId, {
              draggingReferenceId:
                prev.draggingReferenceId === refId ? null : prev.draggingReferenceId,
              dropTargetReferenceId:
                prev.dropTargetReferenceId === refId ? null : prev.dropTargetReferenceId,
              dropInsertIndex: prev.dropInsertIndex,
            });
          }
          return {
            inputFrames: withFrame(s.inputFrames, frameId, (f) => ({
              ...f,
              references: f.references.filter((r) => r.id !== refId),
            })),
            filmstripDrag: nextDrag,
          };
        }),

      reorderReferenceInFrame: (frameId, fromIndex, toIndex) =>
        set((s) => {
          const frame = s.inputFrames.find((f) => f.id === frameId);
          if (!frame) return s;
          const next = frame.references.slice();
          if (
            fromIndex < 0 ||
            fromIndex >= next.length ||
            toIndex < 0 ||
            toIndex >= next.length ||
            fromIndex === toIndex
          ) {
            return s;
          }
          const [moved] = next.splice(fromIndex, 1);
          next.splice(toIndex, 0, moved);
          return {
            inputFrames: withFrame(s.inputFrames, frameId, (f) => ({
              ...f,
              references: next,
            })),
          };
        }),

      clearReferencesInFrame: (frameId) =>
        set((s) => {
          const frame = s.inputFrames.find((f) => f.id === frameId);
          if (!frame) return s;
          for (const ref of frame.references) URL.revokeObjectURL(ref.imageData);
          const nextDrag = new Map(s.filmstripDrag);
          nextDrag.delete(frameId);
          return {
            inputFrames: withFrame(s.inputFrames, frameId, (f) => ({
              ...f,
              references: [],
            })),
            filmstripDrag: nextDrag,
          };
        }),

      // Per-frame filmstrip drag state. Default-construct the entry on demand
      // so callers don't need to seed it first.
      setDraggingReferenceInFrame: (frameId, refId) =>
        set((s) => {
          const next = new Map(s.filmstripDrag);
          const prev = next.get(frameId) ?? {
            draggingReferenceId: null,
            dropTargetReferenceId: null,
            dropInsertIndex: null,
          };
          next.set(frameId, { ...prev, draggingReferenceId: refId });
          return { filmstripDrag: next };
        }),

      setDropTargetReferenceInFrame: (frameId, refId) =>
        set((s) => {
          const next = new Map(s.filmstripDrag);
          const prev = next.get(frameId) ?? {
            draggingReferenceId: null,
            dropTargetReferenceId: null,
            dropInsertIndex: null,
          };
          next.set(frameId, { ...prev, dropTargetReferenceId: refId });
          return { filmstripDrag: next };
        }),

      setDropInsertIndexInFrame: (frameId, index) =>
        set((s) => {
          const next = new Map(s.filmstripDrag);
          const prev = next.get(frameId) ?? {
            draggingReferenceId: null,
            dropTargetReferenceId: null,
            dropInsertIndex: null,
          };
          next.set(frameId, { ...prev, dropInsertIndex: index });
          return { filmstripDrag: next };
        }),

      // Per-frame mask state

      addMaskLineToFrame: (frameId, line) =>
        set((s) => ({
          inputFrames: withFrame(s.inputFrames, frameId, (f) => ({
            ...f,
            maskLines: [...f.maskLines, line],
          })),
        })),

      clearMaskLinesInFrame: (frameId) =>
        set((s) => ({
          inputFrames: withFrame(s.inputFrames, frameId, (f) => ({
            ...f,
            maskLines: [],
          })),
        })),

      // Whole-frame drag (vertical reorder of the input column)

      setInputFrameDrag: (drag) => set({ inputFrameDrag: drag }),

      // Selectors

      getActiveInitialFrame: () => {
        const { inputFrames, activeInputFrameId } = get();
        if (!activeInputFrameId) return null;
        const frame = inputFrames.find((f) => f.id === activeInputFrameId);
        return frame && frame.mode === "initial" ? frame : null;
      },

      getInputFrame: (frameId) => get().inputFrames.find((f) => f.id === frameId),
    }),
    {
      // The key changed with the record format; the version 3 record stays
      // under "enso-canvas" for builds that still read JSON.
      name: "enso-canvas-v4",
      storage: canvasIdbStorage,
      version: 4,
      migrate: (persisted, version) => {
        if (version !== 3) return EMPTY_RECORD;
        return migrateV3(persisted as LegacyPersistedCanvasState);
      },
      partialize: (state): PersistedCanvasState => ({
        viewport: state.viewport,
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
        inputFrames: state.inputFrames.map((frame) => ({
          id: frame.id,
          mode: frame.mode,
          layers: frame.layers.map(stripLayerForPersist).filter(Boolean),
          activeLayerId: frame.activeLayerId,
          maskLines: frame.maskLines,
          references: frame.references.map(stripReferenceInputForPersist),
        })),
        activeInputFrameId: state.activeInputFrameId,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<PersistedCanvasState> | undefined;
        if (!saved) return current;
        return {
          ...current,
          viewport: saved.viewport ?? current.viewport,
          activeTool: saved.activeTool ?? current.activeTool,
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
          inputFrames: saved.inputFrames
            ? saved.inputFrames.map((frame) => ({
                id: frame.id,
                mode: frame.mode,
                layers: frame.layers.map(rehydrateLayer),
                activeLayerId: frame.activeLayerId ?? null,
                maskLines: frame.maskLines ?? [],
                references: frame.references.map(rehydrateReferenceInput),
              }))
            : current.inputFrames,
          activeInputFrameId: saved.activeInputFrameId ?? current.activeInputFrameId,
        };
      },
    },
  ),
);
