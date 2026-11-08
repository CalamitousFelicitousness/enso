import { useCanvasStore } from "@/stores/canvasStore";
import { useVideoCanvasStore } from "@/stores/videoCanvasStore";
import { createCamera } from "./camera";

// Paired here so a camera can never drive a canvas backed by the other store.
export const mainCamera = createCamera(useCanvasStore, {
  onGesture: () => useCanvasStore.getState().switchToCanvasMode(),
  canGesture: () => !useCanvasStore.getState().modeLocked,
});
export const videoCamera = createCamera(useVideoCanvasStore);
