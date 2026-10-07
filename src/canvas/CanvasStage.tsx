import { useRef, useEffect, useState, useCallback } from "react";
import { Stage } from "react-konva";
import { useCanvasStore } from "@/stores/canvasStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useInputStore } from "@/stores/inputStore";
import { usePanZoom } from "./tools/usePanZoom";
import { useMaskPaint } from "./tools/useMaskPaint";
import { useImageTransform } from "./tools/useImageTransform";
import { useSnap } from "./tools/useSnap";
import { useTransformerTarget } from "./tools/useTransformerTarget";
import { FrameLayer } from "./layers/FrameLayer";
import { MaskLayer } from "./layers/MaskLayer";
import { ChromeLayer } from "./layers/ChromeLayer";
import { OutputLayer } from "./layers/OutputLayer";
import { ProcessedLayer } from "./layers/ProcessedLayer";
import { getOrderedFrames, computeFocusViewport } from "./frameList";
import type { CanvasLayout } from "./useCanvasLayout";
import { frameBox, type ComposedFramePosition } from "@/lib/inputs/layout";
import { CanvasBackground } from "./CanvasBackground";
import { mainViewport } from "./viewportAdapter";
import { useKeepAliveVisible } from "@/components/ui/keep-alive";
import type Konva from "konva";
import "./konvaSetup";

// Read at event time so a lock or mode change does not re-render the stage.
const canvasCanGesture = () => !useCanvasStore.getState().modeLocked;
const canvasOnGesture = () => useCanvasStore.getState().switchToCanvasMode();

const PADDING = 32;
const LABEL_HEIGHT = 19;

interface CanvasStageProps {
  layout: CanvasLayout;
  /** An empty composed frame was clicked: open the file picker for it. */
  onPickFile?: (frameId: string) => void;
  /** A set frame's +Add cell was clicked: open the picker to append a cell. */
  onAddCell?: (frameId: string) => void;
}

export function CanvasStage({ layout, onPickFile, onAddCell }: CanvasStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const viewport = useCanvasStore((s) => s.viewport);
  const setViewport = useCanvasStore((s) => s.setViewport);
  const frameW = useGenerationStore((s) => s.width);
  const frameH = useGenerationStore((s) => s.height);
  const canvasMode = useCanvasStore((s) => s.canvasMode);
  const focusedFrameId = useCanvasStore((s) => s.focusedFrameId);
  const focusFitTrigger = useCanvasStore((s) => s.focusFitTrigger);
  const selectedFrameId = useInputStore((s) => s.selectedFrameId);
  const visible = useKeepAliveVisible();

  const panZoom = usePanZoom({
    stageRef,
    viewport: mainViewport,
    canGesture: canvasCanGesture,
    onGesture: canvasOnGesture,
    enabled: visible,
  });
  const maskPaint = useMaskPaint({ stageRef, spaceHeld: panZoom.spaceHeld, layout });
  const imageTransform = useImageTransform(stageRef);

  const { outputX, processedX, showProcessedFrame, totalBounds, displayScale } = layout;

  // Picture nodes register from FrameLayer and mask nodes from MaskLayer;
  // the Transformer finds its target among them.
  const { setNodeRef } = useTransformerTarget(trRef);

  // Snap targets the selected composed frame's bounds in pixel space:
  // (frame.x / ds, frame.y / ds) puts the display-space origin where the
  // per-picture x/y already are.
  const focusedComposed = layout.frames.find(
    (f): f is ComposedFramePosition => f.kind === "composed" && f.frameId === selectedFrameId,
  );
  const snap = useSnap(
    focusedComposed?.frameW ?? 0,
    focusedComposed?.frameH ?? 0,
    trRef,
    focusedComposed ? focusedComposed.x / displayScale : 0,
    focusedComposed ? focusedComposed.y / displayScale : 0,
    displayScale,
  );

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

  // Remeasure on KeepAlive reveal: closes the race where the observer is
  // late and the auto-fit effect would skip with 0x0 dimensions.
  useEffect(() => {
    if (!visible) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setContainerSize({ width: rect.width, height: rect.height });
    }
  }, [visible]);

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
    const x = (containerSize.width - totalWidth * scale) / 2 - totalBounds.minX * scale;
    const y = (containerSize.height - totalHeight * scale) / 2 + LABEL_HEIGHT * scale;
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

  // A reveal request pans a frame the selection landed on into view, once
  // per request, keeping the zoom. Focus mode reveals through focusedFrameId.
  const reveal = useCanvasStore((s) => s.reveal);
  const revealedRef = useRef(0);
  useEffect(() => {
    if (!reveal || reveal.n === revealedRef.current) return;
    if (canvasMode !== "canvas" || containerSize.width <= 0) return;
    const frame = layout.frames.find((f) => f.frameId === reveal.frameId);
    if (!frame) return;
    revealedRef.current = reveal.n;
    const box = frameBox(frame);
    const { x, y, scale } = useCanvasStore.getState().viewport;
    const left = box.x * scale + x;
    const top = box.y * scale + y;
    const inView =
      left >= 0 &&
      top >= 0 &&
      left + box.width * scale <= containerSize.width &&
      top + box.height * scale <= containerSize.height;
    if (inView) return;
    setViewport({
      x: containerSize.width / 2 - (box.x + box.width / 2) * scale,
      y: containerSize.height / 2 - (box.y + box.height / 2) * scale,
    });
  }, [reveal, canvasMode, layout, containerSize, setViewport]);

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
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden"
      data-key-surface="canvas"
    >
      {containerSize.width > 0 && containerSize.height > 0 && (
        <>
          <CanvasBackground
            width={containerSize.width}
            height={containerSize.height}
            viewport={viewport}
            bus={mainViewport.bus}
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
            {/* FrameLayer draws every frame in both columns and owns picture
              interaction. Masks and strokes render on MaskLayer above it; the
              cursor, Transformer and snap guides on ChromeLayer. */}
            <FrameLayer
              frames={layout.frames}
              displayScale={displayScale}
              setNodeRef={setNodeRef}
              snap={snap}
              onPickFile={onPickFile}
              onAddCell={onAddCell}
            />

            <MaskLayer
              frames={layout.frames}
              displayScale={displayScale}
              setNodeRef={setNodeRef}
              snap={snap}
              setActiveLineNode={maskPaint.setActiveLineNode}
            />

            <OutputLayer
              offsetX={outputX}
              placeholderWidth={layout.outputDisplayW}
              placeholderHeight={layout.outputDisplayH}
            />

            {showProcessedFrame && (
              <ProcessedLayer
                offsetX={processedX}
                width={layout.outputDisplayW}
                height={layout.outputDisplayH}
              />
            )}

            <ChromeLayer
              focusedFrame={focusedComposed}
              displayScale={displayScale}
              trRef={trRef}
              snap={snap}
              setCursorNode={maskPaint.setCursorNode}
            />
          </Stage>
        </>
      )}
    </div>
  );
}
