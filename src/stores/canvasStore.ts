import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useGenerationStore } from "@/stores/generationStore";
import { useUiStore } from "@/stores/uiStore";
import { base64ToBlob } from "@/lib/utils";
import { createIdbStorage } from "@/lib/idbStorage";
import { createInitialFrame, createReferenceFrame } from "@/canvas/inputFrames";
import type { FrameId } from "@/canvas/frameList";
import type { InputFrame, InputFrameMode } from "@/canvas/inputFrames";

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

/** One ordered entry in the Reference filmstrip — sibling concept to ImageLayer.
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

/** One mask paint stroke. Owned by an Initial-mode InputFrame's
 * `maskLines` array; sourced by exportMask() at submit time to produce the
 * baked mask sent to the backend. Was on img2imgStore prior to the
 * multi-Input-frame refactor (Phase 2); the type definition lives here now
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

  // ── Phase 2: per-Input-frame state ──────────────────────────────────────
  // The new multi-Input-frame surface. Lives in parallel with the singular
  // fields above (inputRole, layers, referenceInputs) until Phase 9 deletes
  // the legacy surface. New code (InputFrameLayer, InputFramePanel, the
  // refactored wire builder) uses these per-frame mutations; legacy code
  // continues to read the singular fields.

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

  // Per-frame layer mutations (scoped variants of the singular versions
  // above). Naming uses ToFrame/InFrame/FromFrame suffix during the
  // transition so both surfaces can coexist; Phase 9 drops the legacy ones
  // and (optionally) renames these to the bare names.
  addImageLayerToFrame: (
    frameId: string,
    file: File,
    base64: string,
    objectUrl: string,
    w: number,
    h: number,
  ) => void;
  addLayerToFrame: (frameId: string, layer: CanvasLayer) => void;
  removeLayerFromFrame: (frameId: string, layerId: string) => void;
  updateLayerInFrame: (frameId: string, layerId: string, updates: Partial<CanvasLayer>) => void;
  setActiveLayerInFrame: (frameId: string, layerId: string | null) => void;
  clearLayersInFrame: (frameId: string) => void;
  restoreImageLayerToFrame: (frameId: string, base64: string, w: number, h: number) => void;
  getImageLayersInFrame: (frameId: string) => ImageLayer[];
  getMaskLayersInFrame: (frameId: string) => MaskObjectLayer[];
  replaceMaskLayersInFrame: (frameId: string, newLayers: MaskObjectLayer[]) => void;
  removeMaskLayersInFrame: (frameId: string) => void;

  // Per-frame reference filmstrip mutations
  appendReferenceToFrame: (
    frameId: string,
    file: File,
    base64: string,
    objectUrl: string,
    w: number,
    h: number,
  ) => void;
  replaceReferenceInFrame: (
    frameId: string,
    refId: string,
    file: File,
    base64: string,
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
  setMaskDataForFrame: (frameId: string, dataUrl: string | null) => void;

  // Whole-frame drag (vertical reorder of the input column)
  setInputFrameDrag: (drag: { fromIndex: number; toIndex: number | null } | null) => void;

  // Selectors
  getActiveInitialFrame: () => InputFrame | null;
  getInputFrame: (frameId: string) => InputFrame | undefined;
}

/** Per-frame projection of an InputFrame for IndexedDB storage. Each frame's
 * layers + references go through the same strip-then-rehydrate dance the
 * singular `layers`/`referenceInputs` arrays use: File + objectUrl are
 * stripped before persist, recreated on rehydrate from the surviving base64
 * payload. */
interface PersistedInputFrame {
  id: string;
  mode: InputFrameMode;
  layers: CanvasLayer[];
  activeLayerId: string | null;
  maskLines: MaskLine[];
  maskData: string | null;
  references: ReferenceInput[];
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
  // Phase 2 additions
  inputFrames: PersistedInputFrame[];
  activeInputFrameId: string | null;
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

/** Strip a CanvasLayer for storage: drop File + object URL, keep base64.
 * Mirrors the inline strip used by the legacy partialize so per-frame
 * layers serialize identically to their singular-store counterparts. */
function stripLayerForPersist(layer: CanvasLayer): CanvasLayer {
  if (layer.type === "image") {
    const { file: _file, imageData: _url, ...rest } = layer as ImageLayer;
    return { ...rest, imageData: "", file: undefined } as unknown as CanvasLayer;
  }
  if (layer.type === "mask") {
    const { imageData: _url, ...rest } = layer as MaskObjectLayer;
    return { ...rest, imageData: "" } as unknown as CanvasLayer;
  }
  return layer;
}

/** Strip a ReferenceInput for storage: drop File + object URL, keep base64. */
function stripReferenceInputForPersist(ref: ReferenceInput): ReferenceInput {
  const { file: _file, imageData: _url, ...rest } = ref;
  return { ...rest, imageData: "", file: undefined } as unknown as ReferenceInput;
}

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

/** Migrate a persisted v0 canvasStore blob to v1.
 *
 * v0 (pre-Phase-2): singular `inputRole + layers + referenceInputs`.
 * v1 (Phase 2+): adds `inputFrames + activeInputFrameId` derived from the
 * legacy singular fields. Exactly one InputFrame is produced, mirroring
 * what the user had on the canvas before the upgrade.
 *
 * Three v0 shapes map to v1 frames:
 *
 *   - inputRole === "initial"
 *       → one Initial frame containing the legacy layers
 *   - inputRole === "reference" && referenceInputs.length > 0
 *       → one Reference frame containing those references (layers kept on
 *         the frame so a flip back to Initial restores them)
 *   - inputRole === "reference" && referenceInputs.length === 0 &&
 *     layers.length > 0
 *       → one Reference frame seeded with the first visible ImageLayer
 *         wrapped as a ReferenceInput, mirroring the legacy setInputRole
 *         auto-migration
 *
 * The seed ReferenceInput's `file` is left as undefined; the persist
 * middleware's `merge` reconstructs it from base64 via
 * `rehydrateReferenceInput` before the store sees it. Legacy fields stay
 * populated so Phase 2-8 consumers still find them; Phase 9 deletes them.
 *
 * Exported for testability: a snapshot of a v0 IDB blob can be replayed
 * through this function in isolation. */
export function migrateCanvasV0toV1(v0: unknown): PersistedCanvasState {
  if (!v0 || typeof v0 !== "object") {
    // Defensive: no usable persisted state, produce a fresh v1 default.
    return {
      viewport: { x: 0, y: 0, scale: 1 },
      layers: [],
      activeLayerId: null,
      activeTool: "move",
      inputRole: "initial",
      brushSize: 20,
      brushHardness: 0.8,
      brushColor: "#ffffff",
      brushOpacity: 1,
      maskVisible: true,
      maskColor: "#ff000080",
      panelCollapsedOverrides: [],
      canvasMode: "focus",
      focusedFrameId: null,
      modeLocked: false,
      referenceInputs: [],
      inputFrames: [],
      activeInputFrameId: null,
    };
  }

  const state = v0 as Partial<PersistedCanvasState>;
  // Already migrated - pass through.
  if (state.inputFrames !== undefined) {
    return state as PersistedCanvasState;
  }

  const seedFrameId = crypto.randomUUID();
  const layers = state.layers ?? [];
  const referenceInputs = state.referenceInputs ?? [];
  const inputRole = state.inputRole ?? "initial";

  let seedFrame: PersistedInputFrame;
  if (inputRole === "initial") {
    seedFrame = {
      id: seedFrameId,
      mode: "initial",
      layers,
      activeLayerId: state.activeLayerId ?? null,
      maskLines: [],
      maskData: null,
      references: [],
    };
  } else if (referenceInputs.length > 0) {
    seedFrame = {
      id: seedFrameId,
      mode: "reference",
      layers,
      activeLayerId: null,
      maskLines: [],
      maskData: null,
      references: referenceInputs,
    };
  } else {
    // Reference mode without persisted refs - seed from first visible
    // ImageLayer if one exists; otherwise leave references empty.
    const firstImage = layers.find(
      (l): l is ImageLayer => l.type === "image" && (l as ImageLayer).visible,
    );
    const seededRefs: ReferenceInput[] = firstImage
      ? [
          {
            id: crypto.randomUUID(),
            // file + imageData are left blank here; the merge step's
            // rehydrateReferenceInput reconstructs both from base64.
            file: undefined as unknown as File,
            base64: firstImage.base64,
            imageData: "",
            naturalWidth: firstImage.naturalWidth,
            naturalHeight: firstImage.naturalHeight,
            filename: firstImage.name || "image.png",
          },
        ]
      : [];
    seedFrame = {
      id: seedFrameId,
      mode: "reference",
      layers,
      activeLayerId: null,
      maskLines: [],
      maskData: null,
      references: seededRefs,
    };
  }

  return {
    viewport: state.viewport ?? { x: 0, y: 0, scale: 1 },
    layers,
    activeLayerId: state.activeLayerId ?? null,
    activeTool: state.activeTool ?? "move",
    inputRole,
    brushSize: state.brushSize ?? 20,
    brushHardness: state.brushHardness ?? 0.8,
    brushColor: state.brushColor ?? "#ffffff",
    brushOpacity: state.brushOpacity ?? 1,
    maskVisible: state.maskVisible ?? true,
    maskColor: state.maskColor ?? "#ff000080",
    panelCollapsedOverrides: state.panelCollapsedOverrides ?? [],
    canvasMode: state.canvasMode ?? "focus",
    focusedFrameId: state.focusedFrameId ?? null,
    modeLocked: state.modeLocked ?? false,
    referenceInputs,
    inputFrames: [seedFrame],
    activeInputFrameId: seedFrameId,
  };
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
      inputFrames: [seedFrame],
      activeInputFrameId: seedFrame.id,
      filmstripDrag: new Map<string, FilmstripDragState>(),
      inputFrameDrag: null,

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

      // ── Phase 2: per-Input-frame mutations ────────────────────────────

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
            toIndex > next.length ||
            fromIndex === toIndex
          ) {
            return s;
          }
          const [moved] = next.splice(fromIndex, 1);
          const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex;
          next.splice(insertAt, 0, moved);
          return { inputFrames: next };
        }),

      setActiveInputFrame: (frameId) => set({ activeInputFrameId: frameId }),

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
                base64: firstImage.base64,
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

      addImageLayerToFrame: (frameId, file, base64, objectUrl, w, h) => {
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

      restoreImageLayerToFrame: (frameId, base64, w, h) => {
        const frame = get().inputFrames.find((f) => f.id === frameId);
        if (!frame) return;
        for (const layer of frame.layers) {
          if (layer.type === "image") {
            URL.revokeObjectURL((layer as ImageLayer).imageData);
          }
        }
        const blob = base64ToBlob(base64);
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

      appendReferenceToFrame: (frameId, file, base64, objectUrl, w, h) => {
        const ref: ReferenceInput = {
          id: crypto.randomUUID(),
          file,
          base64,
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

      replaceReferenceInFrame: (frameId, refId, file, base64, objectUrl, w, h) =>
        set((s) => ({
          inputFrames: withFrame(s.inputFrames, frameId, (f) => ({
            ...f,
            references: f.references.map((ref) => {
              if (ref.id !== refId) return ref;
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
          })),
        })),

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
            toIndex > next.length ||
            fromIndex === toIndex
          ) {
            return s;
          }
          const [moved] = next.splice(fromIndex, 1);
          const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex;
          next.splice(insertAt, 0, moved);
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
                maskLines: [],
                maskData: null,
                layers: f.layers.filter((l) => l.type !== "mask"),
                activeLayerId: activeIsMask ? null : f.activeLayerId,
              };
            }),
          };
        }),

      setMaskDataForFrame: (frameId, dataUrl) =>
        set((s) => ({
          inputFrames: withFrame(s.inputFrames, frameId, (f) => ({
            ...f,
            maskData: dataUrl,
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
      name: "enso-canvas",
      storage: createJSONStorage(() => canvasIdbStorage),
      version: 1,
      migrate: (persistedState, fromVersion) => {
        // Persist middleware fires migrate only when fromVersion <
        // config.version. Pre-Phase-3 blobs have no version field and are
        // treated as version 0; this branch derives inputFrames from the
        // singular legacy fields. Future migrations chain via additional
        // version checks here.
        if (fromVersion < 1) return migrateCanvasV0toV1(persistedState);
        return persistedState;
      },
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
        inputFrames: state.inputFrames.map((frame) => ({
          id: frame.id,
          mode: frame.mode,
          layers: frame.layers.map(stripLayerForPersist),
          activeLayerId: frame.activeLayerId,
          maskLines: frame.maskLines,
          maskData: frame.maskData,
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
          inputFrames: saved.inputFrames
            ? saved.inputFrames.map((frame) => ({
                id: frame.id,
                mode: frame.mode,
                layers: frame.layers.map(rehydrateLayer),
                activeLayerId: frame.activeLayerId ?? null,
                maskLines: frame.maskLines ?? [],
                maskData: frame.maskData ?? null,
                references: frame.references.map(rehydrateReferenceInput),
              }))
            : current.inputFrames,
          activeInputFrameId: saved.activeInputFrameId ?? current.activeInputFrameId,
        };
      },
    },
  ),
);
