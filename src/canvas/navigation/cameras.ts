import { toast } from "sonner";
import { useCanvasStore } from "@/stores/canvasStore";
import { useUiStore } from "@/stores/uiStore";
import { useVideoCanvasStore } from "@/stores/videoCanvasStore";
import { createCamera } from "./camera";
import { FLIP_NOTICE } from "./text";

// Paired here so a camera can never drive a canvas backed by the other store.
export const mainCamera = createCamera(useCanvasStore);
export const videoCamera = createCamera(useVideoCanvasStore);

// Focus mode is the camera following the current frame. The pill and F set
// the mode before they move the camera; anything else that stops the follow
// leaves Focus, and says so once.
mainCamera.subscribeFollow((follow) => {
  const canvas = useCanvasStore.getState();
  if (follow === "frame") {
    if (canvas.canvasMode !== "focus") canvas.setCanvasMode("focus");
    return;
  }
  if (canvas.canvasMode !== "focus") return;
  canvas.flipToCanvasMode();
  const ui = useUiStore.getState();
  if (!ui.focusFlipNoticed) {
    ui.setFocusFlipNoticed();
    toast.info(FLIP_NOTICE);
  }
});
