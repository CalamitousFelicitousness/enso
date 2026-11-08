import { useRef, useEffect, useState, useCallback } from "react";
import { Stage } from "react-konva";
import { VideoFrameLayer } from "./layers/VideoFrameLayer";
import { VideoReferencesLayer } from "./layers/VideoReferencesLayer";
import { VideoOutputFrame } from "./layers/VideoOutputFrame";
import type { VideoCanvasLayout } from "./useVideoFrameLayout";
import type { VideoSlotId } from "@/stores/videoCanvasStore";
import { videoCamera } from "./navigation/cameras";
import type Konva from "konva";
import "./konvaSetup";

interface VideoCanvasStageProps {
  layout: VideoCanvasLayout;
  onPickImage?: (which: VideoSlotId) => void;
}

export function VideoCanvasStage({ layout, onPickImage }: VideoCanvasStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const { initX, lastX, referencesX, outputX, displayW, displayH } = layout;
  const attachStage = useCallback((stage: Konva.Stage | null) => videoCamera.attach(stage), []);

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

  return (
    <div ref={containerRef} className="w-full h-full overflow-hidden" data-key-surface="canvas">
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
