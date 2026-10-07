// Where the frames sit on the canvas, from the outline alone. Image frames
// (Initial, Reference) stack in the input column at x = 0; control frames
// (Control, IP-Adapter) stack in a column to its left; the output sits to the
// right, and the processed composite beyond it. Everything is in display
// units: frame pixels scaled so the frame is REFERENCE_HEIGHT tall.

import {
  computeReferenceGridColumns,
  computeReferenceGridRows,
  INPUT_FRAME_GAP,
  REFERENCE_CHILD_GAP,
  REFERENCE_MIN_CELL_HEIGHT,
  REFERENCE_MOTHER_PADDING,
} from "./grid";
import type { OutlineEntry } from "./outline";
import type { FrameRole, Size } from "./types";

/** Every frame is laid out as if the generation frame were this many display units tall. */
export const REFERENCE_HEIGHT = 512;
/** Between a frame and its dock or processed map. */
export const ELEMENT_GAP = 16;
/** The processed map's header bar. */
export const PROCESSED_HEADER_HEIGHT = 30;
/** Collapsed dock before the label scale: its header plus a 1px border. */
const DOCK_HEIGHT = 32;
const FRAME_GAP = 48;

/** A composed frame: Initial or Control, drawn as one picture at the frame's
 * size. Pixel-space dims drive the flatten; display-space drives Konva. */
export interface ComposedFramePosition {
  kind: "composed";
  role: Extract<FrameRole, "initial" | "control">;
  frameId: string;
  /** Display-space top-left within the canvas Stage. */
  x: number;
  y: number;
  /** Pixel-space frame dimensions (the flatten target): the generation size. */
  frameW: number;
  frameH: number;
  /** Display-space dimensions = frameW/H * displayScale. */
  displayW: number;
  displayH: number;
  /** The frame sends a picture, or holds one no control model takes. */
  filled: boolean;
  /** Display-space top of the processed map shown under a Control frame, when it has one. */
  processedY: number | null;
}

/** One child cell inside a set frame's grid. Position is display-space
 * relative to the canvas Stage origin (not relative to the mother) so the
 * Konva render path can place each child at frame.x/y without nested Group
 * offsets. */
export interface ReferenceChildPosition {
  refId: string;
  x: number;
  y: number;
  displayW: number;
  displayH: number;
  /** 1-based number this child is sent as; null while it is not sent, always for a control picture. */
  wireIndex: number | null;
  /** Compact per-modality address ("P2", "V1", "A1·V1") when the layout
   * carries mixed media; badge falls back to wireIndex when absent. */
  badge?: string;
}

/** A set frame: Reference or IP-Adapter, drawn as a mother frame with a grid
 * of cells. The mother carries full chrome (border, brackets, header); each
 * child renders inside the mother as a sub-cell with simpler chrome. */
export interface SetFramePosition {
  kind: "set";
  role: Extract<FrameRole, "reference" | "ipAdapter">;
  frameId: string;
  /** Display-space top-left of the mother frame. */
  x: number;
  y: number;
  /** Display-space mother dimensions. Width matches a composed frame at the
   * same display scale; height grows with row count. */
  motherW: number;
  motherH: number;
  /** Per-child cell positions in render order. */
  children: ReferenceChildPosition[];
  /** Position of the trailing +Add cell, or null when the frame takes no more pictures. */
  addCellPosition: { x: number; y: number; w: number; h: number } | null;
}

/** Discriminated union the layout emits per frame, the Konva render layer
 * reads, and the DOM dock orchestrator iterates. Consumers narrow via `kind`
 * for the shape and `role` for the meaning. */
export type FramePosition = ComposedFramePosition | SetFramePosition;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Display-space bounds of a frame position. */
export function frameBox(frame: FramePosition): Box {
  return frame.kind === "composed"
    ? { x: frame.x, y: frame.y, width: frame.displayW, height: frame.displayH }
    : { x: frame.x, y: frame.y, width: frame.motherW, height: frame.motherH };
}

export function inBox(box: Box, x: number, y: number): boolean {
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

export interface LayoutInput {
  entries: OutlineEntry[];
  /** The generation frame, in pixels. */
  frame: Size;
  /** The output frame, in pixels; differs from `frame` when a cloud model picks the size. */
  output: Size;
  labelScale: number;
  /** No frame may take another picture that counts as an input image. */
  inputsAtCapacity: boolean;
  /** A job left a processed composite to show beside the output. */
  compositeProcessed: boolean;
}

export interface FrameLayout {
  frames: FramePosition[];
  /** Factor from frame pixels to display units. */
  displayScale: number;
  displayW: number;
  displayH: number;
  outputX: number;
  outputDisplayW: number;
  outputDisplayH: number;
  processedX: number;
  showProcessedFrame: boolean;
  /** Just below the last frame of each column; 0 when the column is empty. */
  inputColumnBottom: number;
  controlColumnBottom: number;
  controlColumnX: number;
  totalBounds: { minX: number; maxX: number; maxY: number };
}

function setFrame(
  entry: OutlineEntry,
  x: number,
  y: number,
  width: number,
  addCell: boolean,
): SetFramePosition {
  const cols = computeReferenceGridColumns(entry.slots.length);
  const rows = computeReferenceGridRows(entry.slots.length, cols, addCell);
  const contentW = width - REFERENCE_MOTHER_PADDING * 2;
  const cellW = Math.max(0, (contentW - REFERENCE_CHILD_GAP * (cols - 1)) / Math.max(1, cols));
  // Cells are square-ish but floored so an empty grid still reads
  const cellH = Math.max(cellW, REFERENCE_MIN_CELL_HEIGHT);
  const motherH = REFERENCE_MOTHER_PADDING * 2 + rows * cellH + REFERENCE_CHILD_GAP * (rows - 1);
  const cell = (i: number) => ({
    x: x + REFERENCE_MOTHER_PADDING + (i % cols) * (cellW + REFERENCE_CHILD_GAP),
    y: y + REFERENCE_MOTHER_PADDING + Math.floor(i / cols) * (cellH + REFERENCE_CHILD_GAP),
  });
  const children: ReferenceChildPosition[] = entry.slots.map((slot, i) => ({
    refId: slot.pictureId,
    ...cell(i),
    displayW: cellW,
    displayH: cellH,
    wireIndex: slot.address?.n ?? null,
  }));
  const add = cell(entry.slots.length);
  return {
    kind: "set",
    role: entry.role === "ipAdapter" ? "ipAdapter" : "reference",
    frameId: entry.frameId,
    x,
    y,
    motherW: width,
    motherH,
    children,
    addCellPosition: addCell ? { x: add.x, y: add.y, w: cellW, h: cellH } : null,
  };
}

export function computeCanvasLayout(input: LayoutInput): FrameLayout {
  const { frame, output, labelScale } = input;
  const displayScale = frame.height > 0 ? REFERENCE_HEIGHT / frame.height : 1;
  const displayW = frame.width * displayScale;
  const displayH = REFERENCE_HEIGHT;
  const outputDisplayW = output.width * displayScale;
  const outputDisplayH = output.height * displayScale;
  const outputX = displayW + FRAME_GAP;
  const processedX = outputX + outputDisplayW + FRAME_GAP;
  const controlColumnX = -(displayW + FRAME_GAP);
  // A dock floats ELEMENT_GAP above its frame at the label scale
  const stackGap = INPUT_FRAME_GAP + DOCK_HEIGHT * labelScale + ELEMENT_GAP;

  const frames: FramePosition[] = [];
  const bottoms = { input: 0, control: 0 };
  const started = { input: false, control: false };
  let anyProcessed = false;
  for (const entry of input.entries) {
    const column = entry.role === "control" || entry.role === "ipAdapter" ? "control" : "input";
    const x = column === "control" ? controlColumnX : 0;
    const y = started[column] ? bottoms[column] + stackGap : 0;
    started[column] = true;
    if (entry.role === "initial" || entry.role === "control") {
      const processedY =
        entry.processed && entry.status !== "off"
          ? y + displayH + ELEMENT_GAP + PROCESSED_HEADER_HEIGHT * labelScale
          : null;
      if (processedY !== null) anyProcessed = true;
      frames.push({
        kind: "composed",
        role: entry.role,
        frameId: entry.frameId,
        x,
        y,
        frameW: frame.width,
        frameH: frame.height,
        displayW,
        displayH,
        filled: entry.status === "sent" || entry.status === "notSent",
        processedY,
      });
      bottoms[column] = (processedY ?? y) + displayH;
    } else {
      // A Reference cell counts as an input image; an IP-Adapter cell does not
      const addCell = entry.role === "ipAdapter" || !input.inputsAtCapacity;
      const position = setFrame(entry, x, y, displayW, addCell);
      frames.push(position);
      bottoms[column] = y + position.motherH;
    }
  }

  const showProcessedFrame = input.compositeProcessed || anyProcessed;
  return {
    frames,
    displayScale,
    displayW,
    displayH,
    outputX,
    outputDisplayW,
    outputDisplayH,
    processedX,
    showProcessedFrame,
    inputColumnBottom: bottoms.input,
    controlColumnBottom: bottoms.control,
    controlColumnX,
    totalBounds: {
      minX: started.control ? controlColumnX : 0,
      maxX: showProcessedFrame ? processedX + outputDisplayW : outputX + outputDisplayW,
      maxY: Math.max(displayH, outputDisplayH, bottoms.input, bottoms.control),
    },
  };
}
