import { useRef, useEffect, useState, useCallback } from "react";
import { Stage } from "react-konva";
import { useCanvasStore } from "@/stores/canvasStore";
import { useGenerationStore } from "@/stores/generationStore";
import { usePanZoom } from "./tools/usePanZoom";
import { useMaskPaint } from "./tools/useMaskPaint";
import { useImageTransform } from "./tools/useImageTransform";
import { FrameLayer } from "./layers/FrameLayer";
import { CompositeLayer } from "./layers/CompositeLayer";
import { MaskLayer } from "./layers/MaskLayer";
import { OutputLayer } from "./layers/OutputLayer";
import { ProcessedCompositeLayer } from "./layers/ProcessedCompositeLayer";
import { ControlFrameLayer } from "./layers/ControlFrameLayer";
import { getOrderedFrames, computeFocusViewport } from "./frameList";
import type { CanvasLayout } from "./useControlFrameLayout";
import { CanvasBackground } from "./CanvasBackground";
import Konva from "konva";

// Only allow left mouse button to initiate Konva node drags.
// Default is [0, 1] which lets middle-click drag images.
Konva.dragButtons = [0];

const PADDING = 32;
const LABEL_HEIGHT = 19;

interface CanvasStageProps {
  layout: CanvasLayout;
  onPickImage?: (unitIndex: number) => void;
}

export function CanvasStage({ layout, onPickImage }: CanvasStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const viewport = useCanvasStore((s) => s.viewport);
  const setViewport = useCanvasStore((s) => s.setViewport);
  // Note: setSelectedControlFrame removed - panels are now persistent
  const frameW = useGenerationStore((s) => s.width);
  const frameH = useGenerationStore((s) => s.height);
  const inputRole = useCanvasStore((s) => s.inputRole);
  const canvasMode = useCanvasStore((s) => s.canvasMode);
  const focusedFrameId = useCanvasStore((s) => s.focusedFrameId);
  const focusFitTrigger = useCanvasStore((s) => s.focusFitTrigger);

  const panZoom = usePanZoom(stageRef);
  const maskPaint = useMaskPaint({ stageRef, spaceHeld: panZoom.spaceHeld });
  const imageTransform = useImageTransform(stageRef, trRef);

  const {
    outputX,
    processedX,
    showProcessedFrame,
    controlFrames,
    totalBounds,
    displayScale,
    displayW,
    displayH,
  } = layout;

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

  // Canvas-mode auto-fit: show all frames. Runs on initial render and whenever
  // the generation size changes (e.g. autoFitFrame resizing to match image).
  const prevFrameRef = useRef<string>("");
  useEffect(() => {
    if (canvasMode !== "canvas") return;
    if (frameW <= 0 || frameH <= 0) return;
    if (containerSize.width <= 0 || containerSize.height <= 0) return;
    const key = `${frameW}x${frameH}`;
    if (prevFrameRef.current === key) return;
    prevFrameRef.current = key;

    const totalWidth = totalBounds.maxX - totalBounds.minX;
    const totalHeight = LABEL_HEIGHT + totalBounds.maxY;
    const availW = containerSize.width - PADDING * 2;
    const availH = containerSize.height - PADDING * 2;
    const scale = Math.min(availW / totalWidth, availH / totalHeight, 1);
    const x =
      (containerSize.width - totalWidth * scale) / 2 - totalBounds.minX * scale;
    const y =
      (containerSize.height - totalHeight * scale) / 2 + LABEL_HEIGHT * scale;
    setViewport({ x, y, scale });
  }, [canvasMode, containerSize, frameW, frameH, totalBounds, setViewport]);

  // Focus-mode viewport: fit a single frame to fill the container.
  useEffect(() => {
    if (canvasMode !== "focus") return;
    if (containerSize.width <= 0 || containerSize.height <= 0) return;

    const frames = getOrderedFrames(layout);
    const targetId = focusedFrameId ?? "output";
    const frame = frames.find((f) => f.id === targetId) ?? frames.find((f) => f.id === "output");
    if (!frame) return;

    const vp = computeFocusViewport(frame, containerSize.width, containerSize.height);
    setViewport(vp);
  }, [canvasMode, focusedFrameId, focusFitTrigger, layout, containerSize, setViewport]);

  // Reset prevFrameRef when entering canvas mode so auto-fit can re-trigger.
  useEffect(() => {
    if (canvasMode === "canvas") prevFrameRef.current = "";
  }, [canvasMode]);

  // Compose event handlers: maskPaint first, then panZoom
  const onMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      maskPaint.onMouseDown(e);
      panZoom.onMouseDown(e);
    },
    [maskPaint, panZoom],
  );

  const onMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      maskPaint.onMouseMove(e);
      panZoom.onMouseMove(e);
    },
    [maskPaint, panZoom],
  );

  const onMouseUp = useCallback(() => {
    maskPaint.onMouseUp();
    panZoom.onMouseUp();
  }, [maskPaint, panZoom]);

  const onClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.evt.button !== 0) return;
      imageTransform.onStageClick(e);
    },
    [imageTransform],
  );

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden">
      {containerSize.width > 0 && containerSize.height > 0 && (
        <>
        <CanvasBackground
          width={containerSize.width}
          height={containerSize.height}
          viewport={viewport}
        />
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
          onMouseLeave={maskPaint.onMouseLeave}
          onClick={onClick}
        >
          <ControlFrameLayer frames={controlFrames} onPickImage={onPickImage} />

          <CompositeLayer trRef={trRef} displayScale={displayScale} />

          <FrameLayer
            displayScale={displayScale}
            onPickImage={onPickImage ? () => onPickImage(-1) : undefined}
          />

          {inputRole !== "reference" && (
            <MaskLayer
              displayScale={displayScale}
              setActiveLineNode={maskPaint.setActiveLineNode}
              setCursorNode={maskPaint.setCursorNode}
            />
          )}
          <OutputLayer
            offsetX={outputX}
            placeholderWidth={displayW}
            placeholderHeight={displayH}
          />

          {showProcessedFrame && (
            <ProcessedCompositeLayer
              offsetX={processedX}
              width={displayW}
              height={displayH}
            />
          )}
        </Stage>
        </>
      )}
    </div>
  );
}
