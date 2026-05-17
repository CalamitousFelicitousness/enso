import { useMemo } from "react";
import { useControlStore } from "@/stores/controlStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useUiStore } from "@/stores/uiStore";
import { useCanvasStore } from "@/stores/canvasStore";
import type { ImageLayer } from "@/stores/canvasStore";
import { useImg2ImgStore } from "@/stores/img2imgStore";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { resolveGenerationSize } from "@/lib/sizeCompute";

/** Reference height for display-unit normalization: all frames are laid out as
 * if the main frame were this many units tall. Keeps UI panels consistently
 * sized regardless of the actual generation resolution. */
export const REFERENCE_HEIGHT = 512;

const FRAME_GAP = 48;
/** Spacing between adjacent slots in the Reference filmstrip (display units). */
export const FILMSTRIP_SLOT_GAP = 8;
/** Spacing between a frame and its associated elements (processed image, floating panel) */
export const ELEMENT_GAP = 16;
/** Height of the per-unit processed image header bar (matches HEADER_HEIGHT in ControlFramePanel) */
export const PROCESSED_HEADER_HEIGHT = 30;

export interface ProcessedSlot {
  unitIndex: number;
  hasProcessed: boolean;
}

export interface ControlFramePosition {
  unitIndex: number;
  unifiedIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  processedSlots: ProcessedSlot[];
}

/** Position + size for one slot in the Reference filmstrip. Populated when
 * inputRole === "reference" AND referenceInputs.length > 0. Coordinates are in
 * display units (canvas-coord with displayScale applied), measured from the
 * filmstrip's left edge at x=0. Consumer (FrameLayer / ReferenceFilmstripLayer)
 * chooses between rendering this list and the single inputFrame based on
 * whether the list is empty. */
export interface ReferenceFramePosition {
  refId: string;
  x: number;
  y: number;
  /** Pixel-space dims passed to Konva (display = pixel * displayScale). */
  frameW: number;
  frameH: number;
  /** Display-space dims for DOM overlay positioning. */
  displayW: number;
  displayH: number;
}

export interface CanvasLayout {
  showInputFrame: boolean;
  inputX: number;
  outputX: number;
  processedX: number;
  showProcessedFrame: boolean;
  controlFrames: ControlFramePosition[];
  totalBounds: { minX: number; maxX: number; maxY: number };
  /** Generation size (may differ from frame size when scale/megapixel is active) */
  genSize: { width: number; height: number };
  /** Factor to convert pixel coords → display coords: displayCoord = pixelCoord * displayScale */
  displayScale: number;
  /** User-set frame dimensions in display units. Tracks gen.width/height
   * directly. Used by control frames (which size to the intended generation
   * resolution regardless of Auto mode). */
  displayW: number;
  displayH: number;
  /** Input frame dimensions in pixel space. Equals gen.width/height in Initial
   * mode; equals the source image's natural dims in Reference mode (since the
   * image is sent at native resolution, not flattened to the frame). */
  inputFrameW: number;
  inputFrameH: number;
  /** Input frame dimensions in display units (inputFrameW/H * displayScale). */
  inputDisplayW: number;
  inputDisplayH: number;
  /** Output frame dimensions. Equals gen.width/height when Auto is off; when
   * Auto is on for a cloud model, predicts the server-chosen aspect from the
   * last result's echoed dims, falling back to the model's size_constraint
   * default. Lets the canvas show a plausible output shape before generation. */
  outputFrameW: number;
  outputFrameH: number;
  outputDisplayW: number;
  outputDisplayH: number;
  /** Per-slot positions when the Reference filmstrip is populated. Empty array
   * when inputRole !== "reference" or referenceInputs is empty; consumer falls
   * back to the single inputFrame in that case. When non-empty, outputX is
   * pushed right by the filmstrip's total width + FRAME_GAP. */
  referenceFrames: ReferenceFramePosition[];
}

export function useControlFrameLayout(): CanvasLayout {
  const units = useControlStore((s) => s.units);
  const compositeProcessed = useControlStore((s) => s.compositeProcessed);
  const frameW = useGenerationStore((s) => s.width);
  const frameH = useGenerationStore((s) => s.height);
  const lastResult = useGenerationStore((s) => s.results[0]);
  const layers = useCanvasStore((s) => s.layers);
  const inputRole = useCanvasStore((s) => s.inputRole);
  const referenceInputs = useCanvasStore((s) => s.referenceInputs);
  const hasLayers = layers.length > 0;
  const autoFitFrame = useUiStore((s) => s.autoFitFrame);
  const sizeMode = useImg2ImgStore((s) => s.sizeMode);
  const scaleFactor = useImg2ImgStore((s) => s.scaleFactor);
  const megapixelTarget = useImg2ImgStore((s) => s.megapixelTarget);
  const autoSize = useImg2ImgStore((s) => s.autoSize);
  const activeModel = useModelSelectionStore((s) => s.activeModel);

  return useMemo(() => {
    const isAutoFit = hasLayers && autoFitFrame;
    const effectiveSizeMode = isAutoFit ? sizeMode : "fixed";
    const genSize = resolveGenerationSize(
      effectiveSizeMode,
      frameW,
      frameH,
      scaleFactor,
      megapixelTarget,
    );

    // Normalize all layout positions to display units so that UI panels
    // stay a consistent size regardless of the actual generation resolution.
    const ds = frameH > 0 ? REFERENCE_HEIGHT / frameH : 1;
    const dw = frameW * ds;
    const dh = REFERENCE_HEIGHT;

    // In Reference mode the input frame represents the source image, but its
    // display height is normalized to REFERENCE_HEIGHT (same as the output
    // frame) so floating panels and headers line up vertically and the user
    // can compare input/output shapes side by side. Width derives from the
    // image's aspect ratio. Strict WYSIWYG is broken on purpose here:
    // Reference sends the source file at native resolution regardless of
    // canvas geometry, so the visual size disparity that WYSIWYG would
    // otherwise enforce serves no semantic purpose.
    //
    // Initial mode keeps the input frame at gen dims (real WYSIWYG flatten target).
    const firstImage = layers.find((l): l is ImageLayer => l.type === "image" && l.visible) ?? null;
    const isReferenceMode = inputRole === "reference" && firstImage !== null;
    const refAspect =
      isReferenceMode && firstImage.naturalHeight > 0
        ? firstImage.naturalWidth / firstImage.naturalHeight
        : 1;
    const inputFrameH = frameH;
    const inputFrameW = isReferenceMode ? frameH * refAspect : frameW;
    const inputDisplayW = inputFrameW * ds;
    const inputDisplayH = inputFrameH * ds;

    // Auto-aware output frame: when Auto is on for a cloud model, predict the
    // server-chosen aspect from the most recent result's echoed dims, falling
    // back to the model's size_constraint.default. Lets the canvas show a
    // plausible output shape before the user generates rather than the
    // possibly-stale user-set dims. Height stays at frameH so the output
    // frame's display height matches REFERENCE_HEIGHT (header alignment).
    const isCloudModel = activeModel?.source === "cloud";
    const isAutoActive = autoSize && isCloudModel === true;
    let predictedOutputAspect: number | null = null;
    if (isAutoActive) {
      if (lastResult?.info) {
        try {
          const info = JSON.parse(lastResult.info) as { width?: unknown; height?: unknown };
          const w = info.width;
          const h = info.height;
          if (typeof w === "number" && typeof h === "number" && w > 0 && h > 0) {
            predictedOutputAspect = w / h;
          }
        } catch {
          // ignore; fall through to default
        }
      }
      if (
        predictedOutputAspect == null &&
        activeModel?.source === "cloud" &&
        activeModel.size_constraint?.default
      ) {
        const parts = activeModel.size_constraint.default.split("x").map((s) => parseInt(s, 10));
        if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
          predictedOutputAspect = parts[0] / parts[1];
        }
      }
    }
    const outputFrameH = frameH;
    const outputFrameW = predictedOutputAspect != null ? frameH * predictedOutputAspect : frameW;
    const outputDisplayW = outputFrameW * ds;
    const outputDisplayH = outputFrameH * ds;

    // Reference filmstrip: one frame per entry in referenceInputs when the user
    // is in Reference mode and has populated the filmstrip. Each slot inherits
    // the autoscale logic from the single inputFrame case - height locked to
    // frameH (so displays at REFERENCE_HEIGHT), width follows image aspect.
    // Slots are placed left-to-right with FILMSTRIP_SLOT_GAP between them.
    // When empty, falls back to the single-inputFrame path so existing layer-
    // backed Reference workflows keep working until G migrates them in.
    const referenceFrames: ReferenceFramePosition[] = [];
    if (inputRole === "reference" && referenceInputs.length > 0) {
      let cursorDisplayX = 0;
      for (const ref of referenceInputs) {
        const aspect = ref.naturalHeight > 0 ? ref.naturalWidth / ref.naturalHeight : 1;
        const slotFrameH = frameH;
        const slotFrameW = frameH * aspect;
        const slotDisplayW = slotFrameW * ds;
        const slotDisplayH = REFERENCE_HEIGHT;
        referenceFrames.push({
          refId: ref.id,
          x: cursorDisplayX,
          y: 0,
          frameW: slotFrameW,
          frameH: slotFrameH,
          displayW: slotDisplayW,
          displayH: slotDisplayH,
        });
        cursorDisplayX += slotDisplayW + FILMSTRIP_SLOT_GAP;
      }
    }

    // Total filmstrip width in display units. When non-empty, the last slot's
    // right edge sits at (cursor - FILMSTRIP_SLOT_GAP) since the loop appended
    // a trailing gap after each slot.
    const filmstripDisplayW =
      referenceFrames.length > 0
        ? referenceFrames[referenceFrames.length - 1].x +
          referenceFrames[referenceFrames.length - 1].displayW
        : 0;

    // Input frame always visible - always at x=0 (display units). The single
    // inputFrame's right edge defines outputX when filmstrip is empty;
    // otherwise the filmstrip's right edge does.
    const inputX = 0;
    const outputX =
      referenceFrames.length > 0 ? filmstripDisplayW + FRAME_GAP : inputDisplayW + FRAME_GAP;

    // Processed composite frame: visible when backend composite or any per-unit processedImage exists
    const hasAnyProcessed =
      !!compositeProcessed || units.some((u) => u.enabled && !!u.processedImage);
    const processedX = outputX + outputDisplayW + FRAME_GAP;

    // Rightmost edge of main frames (display units)
    const mainMaxX = hasAnyProcessed ? processedX + outputDisplayW : outputX + outputDisplayW;

    // Control frames: only enabled units with imageSource === "separate"
    const activeControlIndices = units
      .map((u, i) => ({ unit: u, index: i }))
      .filter((entry) => entry.unit.enabled && entry.unit.imageSource === "separate");

    // Build control frames with processedSlots - accumulate X to handle variable widths
    const controlFrames: ControlFramePosition[] = [];
    let cursorX = 0;
    for (const entry of activeControlIndices) {
      // Collect all units that share this frame: the owner + any "unit:N" referencing it
      const slots: ProcessedSlot[] = [
        { unitIndex: entry.index, hasProcessed: !!entry.unit.processedImage },
      ];
      for (let i = 0; i < units.length; i++) {
        if (
          i !== entry.index &&
          units[i].enabled &&
          units[i].imageSource === `unit:${entry.index}`
        ) {
          slots.push({ unitIndex: i, hasProcessed: !!units[i].processedImage });
        }
      }

      // Control frames always match the main frame size - the backend resizes
      // control images to the generation resolution before processing.
      const size = { width: dw, height: dh };

      cursorX -= size.width + FRAME_GAP;
      controlFrames.push({
        unitIndex: entry.index,
        unifiedIndex: entry.index + 2,
        x: cursorX,
        y: 0,
        width: size.width,
        height: size.height,
        processedSlots: slots,
      });
    }

    const minX = controlFrames.length > 0 ? controlFrames[controlFrames.length - 1].x : 0;

    // maxY: account for per-frame height + stacked processed slots (display units)
    let maxY = Math.max(dh, inputDisplayH, outputDisplayH);
    for (const f of controlFrames) {
      const activeSlots = f.processedSlots.filter((s) => s.hasProcessed).length;
      const frameMaxY = f.height + activeSlots * (ELEMENT_GAP + PROCESSED_HEADER_HEIGHT + f.height);
      if (frameMaxY > maxY) maxY = frameMaxY;
    }

    return {
      showInputFrame: true,
      inputX,
      outputX,
      processedX,
      showProcessedFrame: hasAnyProcessed,
      controlFrames,
      totalBounds: { minX, maxX: mainMaxX, maxY },
      genSize,
      displayScale: ds,
      displayW: dw,
      displayH: dh,
      inputFrameW,
      inputFrameH,
      inputDisplayW,
      inputDisplayH,
      outputFrameW,
      outputFrameH,
      outputDisplayW,
      outputDisplayH,
      referenceFrames,
    };
  }, [
    units,
    compositeProcessed,
    frameW,
    frameH,
    lastResult,
    layers,
    inputRole,
    referenceInputs,
    hasLayers,
    autoFitFrame,
    sizeMode,
    scaleFactor,
    megapixelTarget,
    autoSize,
    activeModel,
  ]);
}
