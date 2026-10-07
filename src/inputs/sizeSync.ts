// With Fit on, the generation frame takes the size of one input picture, and
// every frame's content is fitted to it whenever that size changes. Width and
// Height typed in by hand stand until then.

import { resolveSizeSource } from "@/lib/inputs/outline";
import type { Size } from "@/lib/inputs/types";
import { snapSize } from "@/lib/sizeCompute";
import { useCanvasStore } from "@/stores/canvasStore";
import { useGenerationStore } from "@/stores/generationStore";
import { inputsReady, useInputStore } from "@/stores/inputStore";
import { useUiStore } from "@/stores/uiStore";
import { outlineOf } from "./outlineOf";

/** Frame size of the size source picture, snapped like any generation size. */
function sourceFrame(): Size | null {
  const { frames, sizeSource } = useInputStore.getState();
  const source = resolveSizeSource(outlineOf(frames).sent, sizeSource);
  if (!source) return null;
  const { sizeMultiple } = useCanvasStore.getState();
  return {
    width: snapSize(source.width, sizeMultiple),
    height: snapSize(source.height, sizeMultiple),
  };
}

const keyOf = (frame: Size | null) => (frame ? `${frame.width}x${frame.height}` : null);

let lastSource: string | null = null;
let keeping = false;

function syncToSource(force: boolean): void {
  if (keeping) return;
  const frame = sourceFrame();
  const key = keyOf(frame);
  if (!force && key === lastSource) return;
  lastSource = key;
  if (!frame || !useUiStore.getState().autoFitFrame) return;
  const gen = useGenerationStore.getState();
  gen.setParam("width", frame.width);
  gen.setParam("height", frame.height);
  useInputStore.getState().refitAll(frame);
}

/** Apply a change that keeps the frame size although the size source picture
 * changes: a picture swapped for one drawn at the frame size, or an Undo
 * putting such a swap back. Its size source is taken as applied, so Width,
 * Height and every placement stay as they are. */
export function keepingSize(apply: () => void): void {
  keeping = true;
  try {
    apply();
  } finally {
    keeping = false;
    lastSource = keyOf(sourceFrame());
  }
}

/** A model with another size multiple re-snaps the frame: from the size source
 * while Fit has one, else the current Width and Height. */
function snapToMultiple(multiple: number): void {
  if (useUiStore.getState().autoFitFrame && sourceFrame()) {
    syncToSource(true);
    return;
  }
  const gen = useGenerationStore.getState();
  gen.setParam("width", snapSize(gen.width, multiple));
  gen.setParam("height", snapSize(gen.height, multiple));
}

let started = false;

/** Start following the size source. Waits for the stored inputs and takes
 * their size source as already applied, so a reload keeps the saved size and
 * layout. */
export function startSizeSync(): void {
  if (started) return;
  started = true;
  void inputsReady().then(() => {
    lastSource = keyOf(sourceFrame());
    // the loaded model can report its multiple before the inputs are in
    const { sizeMultiple } = useCanvasStore.getState();
    const { width, height } = useGenerationStore.getState();
    if (width % sizeMultiple !== 0 || height % sizeMultiple !== 0) snapToMultiple(sizeMultiple);
    useCanvasStore.subscribe((state, prev) => {
      if (state.sizeMultiple !== prev.sizeMultiple) snapToMultiple(state.sizeMultiple);
    });
    useInputStore.subscribe((state, prev) => {
      if (state.frames !== prev.frames || state.sizeSource !== prev.sizeSource) syncToSource(false);
    });
    useUiStore.subscribe((state, prev) => {
      if (state.autoFitFrame && !prev.autoFitFrame) syncToSource(true);
    });
  });
}
