// Foundation types and pure helpers for the multi-Input-frame architecture.
//
// One InputFrame = one canvas-native input slot the user composes into. Each
// frame is independently in Initial mode (composable scene graph: layers,
// mask, transformable) or Reference mode (ordered list of raw reference
// images, "mother frame with grid of children"). The wire's images[] array is
// the flattened ordered enumeration across all frames - Initial contributes
// one slot when it has any visible image layer, Reference contributes one
// slot per child.
//
// Mode flips are non-destructive: layers and references coexist on the same
// frame shape (the inactive arm sits empty), so toggling back and forth
// preserves both kinds of content. See plan: ethereal-swimming-hippo.md.

import type { CanvasLayer, ImageLayer, MaskLine, ReferenceInput } from "@/stores/canvasStore";

export type InputFrameMode = "initial" | "reference";

/** One input slot on the canvas. Single shape regardless of mode - both
 * `layers` and `references` are always non-null; the inactive arm sits empty
 * or stale so mode flips don't destroy work. The render path discriminates
 * on `mode` to decide which arm to display. */
export interface InputFrame {
  /** Stable identifier; survives reorder, mode flip, persistence. Used as the
   * inner part of FrameId (`input:${id}`) and as the key into per-frame state
   * lookups (panelCollapsedOverrides, focusedInputFrameId, etc.). */
  id: string;
  mode: InputFrameMode;
  /** Composable scene graph for Initial mode. Mix of ImageLayer (the source
   * image plus any user-pasted layers) and MaskObjectLayer (committed mask
   * strokes). Reference mode keeps this array intact (non-destructive) but
   * the render path ignores it. */
  layers: CanvasLayer[];
  /** Selected layer in Initial mode (drives Transformer chrome, LayerPanel
   * highlight). Nulled when flipping to Reference so stale selections don't
   * resurface on flip-back. */
  activeLayerId: string | null;
  /** Live paint strokes in Initial mode. Sourced by exportMask() at submit
   * time. Moved off the singleton img2imgStore so per-frame masks survive
   * focus changes. */
  maskLines: MaskLine[];
  /** Baked mask PNG dataURL (set by exportMask at submit time, or imported).
   * Cleared with maskLines on clearInitialMask. */
  maskData: string | null;
  /** Ordered list of reference images for Reference mode. Index in array =
   * wire order within this frame. Reference children flow into the wire's
   * images[] after the previous frame's contribution. */
  references: ReferenceInput[];
}

/** One slot in the flattened wire enumeration across all frames. The wire's
 * images[] is exactly the slots produced by enumerateWireSlots, in order. */
export interface WireSlot {
  frameId: string;
  /** Present for reference children; absent for Initial-mode slots (which
   * represent the frame's flattened composite, not a single ReferenceInput). */
  refId?: string;
  /** Position within the owning frame. Initial frames always have localIndex
   * 0; reference children carry their position in references[]. */
  localIndex: number;
  /** 1-based position in the wire's images[] array. The user refers to this
   * number in prompts ("Image 3 should be a cat"). */
  globalIndex: number;
  mode: InputFrameMode;
}

const VISIBLE_IMAGE: (l: CanvasLayer) => l is ImageLayer = (l): l is ImageLayer =>
  l.type === "image" && l.visible;

/** Walk frames in order, emitting one slot per actually-populated frame
 * (Initial-with-visible-image = 1 slot, Reference = references.length slots).
 * Empty frames contribute nothing so the wire index always matches what the
 * model receives.
 *
 * Stable global ordering: when one frame's mode flips or its references[]
 * grows, every downstream slot shifts by the delta. Consumers that need a
 * specific slot's index should re-read after relevant store mutations. */
export function enumerateWireSlots(frames: InputFrame[]): WireSlot[] {
  const slots: WireSlot[] = [];
  let globalIndex = 1;
  for (const frame of frames) {
    if (frame.mode === "initial") {
      const hasVisibleImage = frame.layers.some(VISIBLE_IMAGE);
      if (hasVisibleImage) {
        slots.push({
          frameId: frame.id,
          localIndex: 0,
          globalIndex,
          mode: "initial",
        });
        globalIndex += 1;
      }
    } else {
      frame.references.forEach((ref, localIndex) => {
        slots.push({
          frameId: frame.id,
          refId: ref.id,
          localIndex,
          globalIndex,
          mode: "reference",
        });
        globalIndex += 1;
      });
    }
  }
  return slots;
}

/** First wire index this frame contributes, or null when the frame is empty
 * (no visible image layer in Initial, no references in Reference). Used by
 * the InputFramePanel header label. */
export function wireIndexForFrame(frames: InputFrame[], frameId: string): number | null {
  const slots = enumerateWireSlots(frames);
  const slot = slots.find((s) => s.frameId === frameId);
  return slot ? slot.globalIndex : null;
}

/** Exact wire index of a specific reference child. Used by the per-child
 * Konva badge inside a Reference mother frame's grid. Returns null when the
 * frame or child isn't found (defensive; callers should ensure validity). */
export function wireIndexForChild(
  frames: InputFrame[],
  frameId: string,
  refId: string,
): number | null {
  const slots = enumerateWireSlots(frames);
  const slot = slots.find((s) => s.frameId === frameId && s.refId === refId);
  return slot ? slot.globalIndex : null;
}

export function newInputFrameId(): string {
  return crypto.randomUUID();
}

export function createInitialFrame(): InputFrame {
  return {
    id: newInputFrameId(),
    mode: "initial",
    layers: [],
    activeLayerId: null,
    maskLines: [],
    maskData: null,
    references: [],
  };
}

export function createReferenceFrame(): InputFrame {
  return {
    id: newInputFrameId(),
    mode: "reference",
    layers: [],
    activeLayerId: null,
    maskLines: [],
    maskData: null,
    references: [],
  };
}
