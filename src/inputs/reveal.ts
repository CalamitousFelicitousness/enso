// Selecting a frame from the Input tab or the palette also brings it into
// view: the camera follows the selection, never the other way round.

import { useCanvasStore } from "@/stores/canvasStore";
import { useInputStore } from "@/stores/inputStore";

export function revealFrame(frameId: string): void {
  useInputStore.getState().selectFrame(frameId);
  useCanvasStore.getState().requestReveal(frameId);
}
