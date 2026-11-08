import { memo, useMemo } from "react";
import type { FrameId } from "@/lib/inputs/frames";
import type { FrameLayout } from "@/lib/inputs/layout";
import { imagesScene } from "@/lib/viewport/scenes";
import { useOutline } from "@/inputs/useOutline";
import { useCanvasStore } from "@/stores/canvasStore";
import { useInputStore } from "@/stores/inputStore";
import { useUiStore } from "@/stores/uiStore";
import { mainCamera } from "./navigation/cameras";
import { Minimap } from "./navigation/Minimap";
import { focusFrame } from "./navigation/useFrameCursor";

interface ImagesMinimapProps {
  layout: FrameLayout;
  current: FrameId;
}

/** The Images canvas's frames on the minimap. */
export const ImagesMinimap = memo(function ImagesMinimap({ layout, current }: ImagesMinimapProps) {
  const { entries } = useOutline();
  const frames = useInputStore((s) => s.frames);
  const on = useUiStore((s) => s.canvasMinimap);
  const setRoom = useCanvasStore((s) => s.setMinimapRoom);
  const scene = useMemo(
    () => imagesScene(layout, entries, frames, current),
    [layout, entries, frames, current],
  );
  return (
    <Minimap camera={mainCamera} frames={scene} on={on} onFocus={focusFrame} onRoom={setRoom} />
  );
});
