import { useRef, useEffect, useLayoutEffect, useState, useMemo, useCallback } from "react";
import { Stage } from "react-konva";
import { useVideoCanvasStore } from "@/stores/videoCanvasStore";
import { useVideoStore } from "@/stores/videoStore";
import { VideoFrameLayer } from "./layers/VideoFrameLayer";
import { VideoReferencesLayer } from "./layers/VideoReferencesLayer";
import { VideoOutputFrame } from "./layers/VideoOutputFrame";
import type { VideoCanvasLayout } from "./useVideoFrameLayout";
import type { VideoSlotId } from "@/stores/videoCanvasStore";
import { videoCamera } from "./navigation/cameras";
import { useChromeBoxes } from "./navigation/chrome";
import { FIT_MAX_SCALE, fitBoxBest, unitScale } from "@/lib/viewport/camera";
import { fitTargets, type FitFrame } from "@/lib/viewport/insets";
import type Konva from "konva";
import "./konvaSetup";

interface VideoCanvasStageProps {
  layout: VideoCanvasLayout;
  onPickImage?: (which: VideoSlotId) => void;
}

export function VideoCanvasStage({ layout, onPickImage }: VideoCanvasStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const setViewport = useVideoCanvasStore((s) => s.setViewport);
  const frameW = useVideoStore((s) => s.width);
  const frameH = useVideoStore((s) => s.height);

  const { initX, lastX, referencesX, outputX, displayW, displayH } = layout;
  const unit = unitScale(layout.displayScale);
  useLayoutEffect(() => videoCamera.setUnit(unit), [unit]);
  const attachStage = useCallback((stage: Konva.Stage | null) => videoCamera.attach(stage), []);

  const chrome = useChromeBoxes(videoCamera.chrome);
  const targets = useMemo(() => {
    const slot = (id: string, x: number): FitFrame => ({
      id,
      box: { x, y: 0, width: displayW, height: displayH },
    });
    const frames: FitFrame[] = [];
    if (layout.showInit) frames.push(slot("init", initX));
    if (layout.showLast) frames.push(slot("last", lastX));
    if (layout.showReferences) frames.push(slot("references", referencesX));
    frames.push(slot("output", outputX));
    return fitTargets(frames, chrome);
  }, [layout, initX, lastX, referencesX, outputX, displayW, displayH, chrome]);

  // Container-responsive sizing; the camera resizes the stage in the same
  // frame, before React catches up
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const size = { width: entry.contentRect.width, height: entry.contentRect.height };
        videoCamera.measure(size);
        setContainerSize(size);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit viewport to show the visible frames on initial render, size change,
  // or when caps hide/show slots
  const prevFrameRef = useRef<string>("");
  useEffect(() => {
    if (frameW <= 0 || frameH <= 0) return;
    if (containerSize.width <= 0 || containerSize.height <= 0) return;
    const key = `${frameW}x${frameH}:${layout.slotCount}`;
    if (prevFrameRef.current === key || !targets.all) return;
    const vp = fitBoxBest(targets.all, containerSize, targets.insets, FIT_MAX_SCALE);
    if (!vp) return;
    prevFrameRef.current = key;
    setViewport(vp);
  }, [containerSize, frameW, frameH, targets, layout.slotCount, setViewport]);

  return (
    <div ref={containerRef} className="w-full h-full overflow-hidden">
      {containerSize.width > 0 && containerSize.height > 0 && (
        <Stage ref={attachStage} width={containerSize.width} height={containerSize.height}>
          {layout.showInit && (
            <VideoFrameLayer
              which="init"
              offsetX={initX}
              width={displayW}
              height={displayH}
              onPickImage={() => onPickImage?.("init")}
            />
          )}

          {layout.showLast && (
            <VideoFrameLayer
              which="last"
              offsetX={lastX}
              width={displayW}
              height={displayH}
              onPickImage={() => onPickImage?.("last")}
            />
          )}

          {layout.showReferences && (
            <VideoReferencesLayer
              offsetX={referencesX}
              width={displayW}
              height={displayH}
              cells={layout.referenceChildren}
              addCell={layout.referenceAddCell}
              onPickAdd={() => onPickImage?.("references")}
            />
          )}

          <VideoOutputFrame offsetX={outputX} width={displayW} height={displayH} />
        </Stage>
      )}
    </div>
  );
}
