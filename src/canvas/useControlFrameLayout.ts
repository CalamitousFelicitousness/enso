import { useMemo } from "react";
import { useControlStore } from "@/stores/controlStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useUiStore } from "@/stores/uiStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { useImg2ImgStore } from "@/stores/img2imgStore";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { resolveGenerationSize } from "@/lib/sizeCompute";
import { enumerateWireSlots } from "@/canvas/inputFrames";
import {
  INPUT_FRAME_GAP,
  REFERENCE_CHILD_GAP,
  REFERENCE_MIN_CELL_HEIGHT,
  REFERENCE_MOTHER_PADDING,
  computeReferenceGridColumns,
  computeReferenceGridRows,
} from "@/canvas/inputFrameLayout";
import type {
  InitialFramePosition,
  InputFramePosition,
  ReferenceChildPosition,
  ReferenceFramePosition as MotherFramePosition,
} from "@/canvas/inputFrameTypes";

/** Reference height for display-unit normalization: all frames are laid out as
 * if the main frame were this many units tall. Keeps UI panels consistently
 * sized regardless of the actual generation resolution. */
export const REFERENCE_HEIGHT = 512;

const FRAME_GAP = 48;
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

export interface CanvasLayout {
  showInputFrame: boolean;
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
  /** Output frame dimensions. Equals gen.width/height when Auto is off; when
   * Auto is on for a cloud model, predicts the server-chosen aspect from the
   * last result's echoed dims, falling back to the model's size_constraint
   * default. Lets the canvas show a plausible output shape before generation. */
  outputFrameW: number;
  outputFrameH: number;
  outputDisplayW: number;
  outputDisplayH: number;
  /** Per-Input-frame layout positions for the multi-Input-frame stack. One
   * entry per frame in `canvasStore.inputFrames` in store order. Vertical
   * stack with INPUT_FRAME_GAP spacing. Initial frames carry display dims
   * matching the generation resolution; Reference frames are mother-grid
   * shells with child cell positions baked in. */
  inputFrames: InputFramePosition[];
  /** Bottom edge of the input column (display units). Y position immediately
   * below the last Input frame, useful for placing the +Add Input Frame
   * affordance and computing canvas-mode totalBounds. */
  inputColumnBottom: number;
}

export function useControlFrameLayout(): CanvasLayout {
  const units = useControlStore((s) => s.units);
  const compositeProcessed = useControlStore((s) => s.compositeProcessed);
  const frameW = useGenerationStore((s) => s.width);
  const frameH = useGenerationStore((s) => s.height);
  const lastResult = useGenerationStore((s) => s.results[0]);
  const storeInputFrames = useCanvasStore((s) => s.inputFrames);
  const hasAnyInputImage = storeInputFrames.some(
    (f) => f.mode === "initial" && f.layers.some((l) => l.type === "image" && l.visible),
  );
  const autoFitFrame = useUiStore((s) => s.autoFitFrame);
  const sizeMode = useImg2ImgStore((s) => s.sizeMode);
  const scaleFactor = useImg2ImgStore((s) => s.scaleFactor);
  const megapixelTarget = useImg2ImgStore((s) => s.megapixelTarget);
  const autoSize = useImg2ImgStore((s) => s.autoSize);
  const activeModel = useModelSelectionStore((s) => s.activeModel);

  return useMemo(() => {
    const isAutoFit = hasAnyInputImage && autoFitFrame;
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

    // Output column sits to the right of the Input column. All Input frames
    // share the gen-resolution column width (dw), so outputX is fixed.
    const outputX = dw + FRAME_GAP;

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
        unifiedIndex: storeInputFrames.length + 1 + entry.index,
        x: cursorX,
        y: 0,
        width: size.width,
        height: size.height,
        processedSlots: slots,
      });
    }

    const minX = controlFrames.length > 0 ? controlFrames[controlFrames.length - 1].x : 0;

    // maxY: account for per-frame height + stacked processed slots (display units)
    let maxY = Math.max(dh, outputDisplayH);
    for (const f of controlFrames) {
      const activeSlots = f.processedSlots.filter((s) => s.hasProcessed).length;
      const frameMaxY = f.height + activeSlots * (ELEMENT_GAP + PROCESSED_HEADER_HEIGHT + f.height);
      if (frameMaxY > maxY) maxY = frameMaxY;
    }

    // ── multi-Input-frame positions ────────────────────────────
    // One InputFramePosition per frame in canvasStore.inputFrames, stacked
    // vertically. Reference frames render as a mother frame with a grid of
    // child cells per the user's mockup. The wireIndex on each entry comes
    // from enumerateWireSlots so the panel header and child badges show
    // the global wire position, not within-frame indexing.
    const activeMaxInputImages =
      activeModel?.source === "cloud" ? (activeModel.max_input_images ?? null) : null;
    const inputFramesPositions: InputFramePosition[] = [];
    const wireSlots = enumerateWireSlots(storeInputFrames);
    let stackY = 0;
    for (const storeFrame of storeInputFrames) {
      if (storeFrame.mode === "initial") {
        const wireIndex = wireSlots.find((s) => s.frameId === storeFrame.id)?.globalIndex ?? null;
        const f: InitialFramePosition = {
          kind: "initial",
          frameId: storeFrame.id,
          x: 0,
          y: stackY,
          frameW,
          frameH,
          displayW: dw,
          displayH: dh,
          wireIndex,
        };
        inputFramesPositions.push(f);
        stackY += dh + INPUT_FRAME_GAP;
      } else {
        // Reference mode: mother frame with grid of children. Mother width
        // matches Initial frames in the same column (dw) so the input
        // column has uniform width regardless of frame mode.
        const refs = storeFrame.references;
        const atCapacity = activeMaxInputImages != null && refs.length >= activeMaxInputImages;
        const includeAddCell = !atCapacity;
        const cols = computeReferenceGridColumns(refs.length);
        const rows = computeReferenceGridRows(refs.length, cols, includeAddCell);
        const motherW = dw;
        const motherContentW = motherW - REFERENCE_MOTHER_PADDING * 2;
        const cellW = Math.max(
          0,
          (motherContentW - REFERENCE_CHILD_GAP * (cols - 1)) / Math.max(1, cols),
        );
        // Cells are square-ish but floored at REFERENCE_MIN_CELL_HEIGHT so
        // an empty grid still renders legibly. Konva contain-fit within the
        // cell preserves each image's aspect ratio.
        const cellH = Math.max(cellW, REFERENCE_MIN_CELL_HEIGHT);
        const motherH =
          REFERENCE_MOTHER_PADDING * 2 + rows * cellH + REFERENCE_CHILD_GAP * (rows - 1);
        const motherX = 0;
        const motherY = stackY;
        const contentX = motherX + REFERENCE_MOTHER_PADDING;
        const contentY = motherY + REFERENCE_MOTHER_PADDING;
        const children: ReferenceChildPosition[] = refs.map((ref, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const wireIndex =
            wireSlots.find((s) => s.frameId === storeFrame.id && s.refId === ref.id)?.globalIndex ??
            -1;
          return {
            refId: ref.id,
            x: contentX + col * (cellW + REFERENCE_CHILD_GAP),
            y: contentY + row * (cellH + REFERENCE_CHILD_GAP),
            displayW: cellW,
            displayH: cellH,
            wireIndex,
          };
        });
        let addCellPosition: { x: number; y: number; w: number; h: number } | null = null;
        if (includeAddCell) {
          const i = refs.length;
          const col = i % cols;
          const row = Math.floor(i / cols);
          addCellPosition = {
            x: contentX + col * (cellW + REFERENCE_CHILD_GAP),
            y: contentY + row * (cellH + REFERENCE_CHILD_GAP),
            w: cellW,
            h: cellH,
          };
        }
        const firstChildWireIndex =
          wireSlots.find((s) => s.frameId === storeFrame.id)?.globalIndex ?? null;
        const f: MotherFramePosition = {
          kind: "reference",
          frameId: storeFrame.id,
          x: motherX,
          y: motherY,
          motherW,
          motherH,
          children,
          addCellPosition,
          firstChildWireIndex,
        };
        inputFramesPositions.push(f);
        stackY += motherH + INPUT_FRAME_GAP;
      }
    }
    // stackY trailed by an extra INPUT_FRAME_GAP after the last frame; back
    // it out for the column bottom.
    const inputColumnBottom = inputFramesPositions.length > 0 ? stackY - INPUT_FRAME_GAP : 0;

    // Extend totalBounds.maxY to include the input column bottom so canvas-
    // mode auto-fit accommodates multiple stacked frames. Output column
    // height (dh, outputDisplayH) still drives the floor for empty stacks.
    const maxYWithInputColumn = Math.max(maxY, inputColumnBottom);

    return {
      showInputFrame: true,
      outputX,
      processedX,
      showProcessedFrame: hasAnyProcessed,
      controlFrames,
      totalBounds: { minX, maxX: mainMaxX, maxY: maxYWithInputColumn },
      genSize,
      displayScale: ds,
      displayW: dw,
      displayH: dh,
      outputFrameW,
      outputFrameH,
      outputDisplayW,
      outputDisplayH,
      inputFrames: inputFramesPositions,
      inputColumnBottom,
    };
  }, [
    units,
    compositeProcessed,
    frameW,
    frameH,
    lastResult,
    storeInputFrames,
    hasAnyInputImage,
    autoFitFrame,
    sizeMode,
    scaleFactor,
    megapixelTarget,
    autoSize,
    activeModel,
  ]);
}
