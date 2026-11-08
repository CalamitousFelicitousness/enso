// The current frame of the Images canvas: what Focus mode fits, what the
// arrows step from and what Zoom to the current frame names. This hook is
// its one writer.

import { useCallback, useEffect, useRef } from "react";
import { useShortcut } from "@/hooks/useShortcut";
import { getOrderedFrames, inputFrameId, parseFrameId, type FrameId } from "@/lib/inputs/frames";
import type { FrameLayout } from "@/lib/inputs/layout";
import { useCanvasStore } from "@/stores/canvasStore";
import { useInputStore } from "@/stores/inputStore";
import { mainCamera } from "./cameras";

/** Switch modes on purpose: Canvas shows everything, Focus fits the current frame. */
export function setViewMode(mode: "focus" | "canvas"): void {
  useCanvasStore.getState().setCanvasMode(mode);
  if (mode === "focus") mainCamera.fitFrame();
  else mainCamera.showAll();
}

/** A frame picked to look at: it becomes the current frame, and Focus fits it. */
export function focusFrame(id: FrameId): void {
  const parsed = parseFrameId(id);
  if (parsed.kind === "input") useInputStore.getState().selectFrame(parsed.id);
  useCanvasStore.getState().setFocusedFrame(id);
  setViewMode("focus");
}

export function useFrameCursor(layout: FrameLayout, visible: boolean): FrameId {
  const current = useCanvasStore((s) => s.focusedFrameId) ?? "output";
  const setCurrent = useCanvasStore((s) => s.setFocusedFrame);
  const selected = useInputStore((s) => s.selectedFrameId);
  // A picture drag, a transform or a mask stroke under way
  const busy = useCanvasStore((s) => s.gestureFrameId !== null);

  // A selection becomes the current frame once the gesture that made it ends,
  // so Focus mode never moves the view under a drag or a stroke
  const synced = useRef<string | null>(null);
  useEffect(() => {
    if (busy || selected === synced.current) return;
    synced.current = selected;
    if (selected) setCurrent(inputFrameId(selected));
  }, [selected, busy, setCurrent]);

  // A frame that goes away hands the cursor to the Output
  useEffect(() => {
    if (current === "output") return;
    if (!getOrderedFrames(layout).some((f) => f.id === current)) setCurrent("output");
  }, [layout, current, setCurrent]);

  // The Input tab and the palette ask for a frame: in Canvas mode the view
  // brings it in at the same zoom; Focus mode fits it as the current frame
  const reveal = useCanvasStore((s) => s.reveal);
  const revealed = useRef(0);
  useEffect(() => {
    if (!reveal || reveal.n === revealed.current) return;
    revealed.current = reveal.n;
    const id = inputFrameId(reveal.frameId);
    setCurrent(id);
    if (useCanvasStore.getState().canvasMode === "canvas") mainCamera.reveal(id, "reveal");
  }, [reveal, setCurrent]);

  // The arrows step through the frames in list order in either mode; an input
  // frame stepped to becomes the selected one, so the inspector follows
  const step = useCallback(
    (delta: number) => {
      const frames = getOrderedFrames(layout);
      const idx = frames.findIndex((f) => f.id === current);
      const next = frames[idx + delta];
      if (idx < 0 || !next) return;
      setCurrent(next.id);
      const parsed = parseFrameId(next.id);
      if (parsed.kind === "input") {
        synced.current = parsed.id;
        useInputStore.getState().selectFrame(parsed.id);
      }
      if (useCanvasStore.getState().canvasMode === "canvas") mainCamera.reveal(next.id, "step");
    },
    [layout, current, setCurrent],
  );
  useShortcut("canvas-focus-prev", () => step(-1), visible);
  useShortcut("canvas-focus-next", () => step(1), visible);
  useShortcut(
    "canvas-toggle-mode",
    () => setViewMode(useCanvasStore.getState().canvasMode === "focus" ? "canvas" : "focus"),
    visible,
  );

  return current;
}
