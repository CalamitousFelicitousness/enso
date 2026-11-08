import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { Stage } from "react-konva";
import { useVideoCanvasStore } from "@/stores/videoCanvasStore";
import { useVideoStore } from "@/stores/videoStore";
import { usePanZoom } from "./tools/usePanZoom";
import { VideoFrameLayer } from "./layers/VideoFrameLayer";
import { VideoReferencesLayer } from "./layers/VideoReferencesLayer";
import { VideoOutputFrame } from "./layers/VideoOutputFrame";
import type { VideoCanvasLayout } from "./useVideoFrameLayout";
import type { VideoSlotId } from "@/stores/videoCanvasStore";
import { videoViewport } from "./viewportAdapter";
import { useChromeBoxes } from "./navigation/chrome";
import { useKeepAliveVisible } from "@/components/ui/keep-alive";
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
  const stageRef = useRef<Konva.Stage>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const viewport = useVideoCanvasStore((s) => s.viewport);
  const setViewport = useVideoCanvasStore((s) => s.setViewport);
  const frameW = useVideoStore((s) => s.width);
  const frameH = useVideoStore((s) => s.height);

  const visible = useKeepAliveVisible();

  const { initX, lastX, referencesX, outputX, displayW, displayH } = layout;
  const unit = unitScale(layout.displayScale);
  const panZoom = usePanZoom({
    stageRef,
    viewport: videoViewport,
    unitScale: unit,
    enabled: visible,
  });

  const chrome = useChromeBoxes(videoViewport.chrome);
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

  // Container-responsive sizing
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
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

  const onMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      panZoom.onMouseDown(e);
    },
    [panZoom],
  );

  const onMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      panZoom.onMouseMove(e);
    },
    [panZoom],
  );

  const onMouseUp = useCallback(() => {
    panZoom.onMouseUp();
  }, [panZoom]);

  return (
    <div ref={containerRef} className="w-full h-full overflow-hidden">
      {containerSize.width > 0 && containerSize.height > 0 && (
        <Stage
          ref={stageRef}
          width={containerSize.width}
          height={containerSize.height}
          x={viewport.x}
          y={viewport.y}
          scaleX={viewport.scale}
          scaleY={viewport.scale}
          onWheel={panZoom.onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
        >
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
