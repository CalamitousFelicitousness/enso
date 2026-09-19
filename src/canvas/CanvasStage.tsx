import { useRef, useEffect, useState, useCallback } from "react";
import { Stage } from "react-konva";
import { useCanvasStore } from "@/stores/canvasStore";
import { useGenerationStore } from "@/stores/generationStore";
import { usePanZoom } from "./tools/usePanZoom";
import { useMaskPaint } from "./tools/useMaskPaint";
import { useImageTransform } from "./tools/useImageTransform";
import { useSnap } from "./tools/useSnap";
import { InputFrameLayer } from "./layers/InputFrameLayer";
import { MaskLayer } from "./layers/MaskLayer";
import { ChromeLayer } from "./layers/ChromeLayer";
import { OutputLayer } from "./layers/OutputLayer";
import { ProcessedCompositeLayer } from "./layers/ProcessedCompositeLayer";
import { ControlFrameLayer } from "./layers/ControlFrameLayer";
import { getOrderedFrames, computeFocusViewport } from "./frameList";
import type { CanvasLayout } from "./useControlFrameLayout";
import type { InitialFramePosition } from "./inputFrameTypes";
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
  onPickImage?: (unitIndex: number) => void;
  /** open the file picker scoped to a specific Initial-mode
   * Input frame (empty-frame click target). */
  onPickInputFile?: (frameId: string) => void;
  /** open the file picker scoped to a Reference frame's +Add
   * cell - appends a new child reference. */
  onAddReferenceChild?: (frameId: string) => void;
}

export function CanvasStage({
  layout,
  onPickImage,
  onPickInputFile,
  onAddReferenceChild,
}: CanvasStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const viewport = useCanvasStore((s) => s.viewport);
  const setViewport = useCanvasStore((s) => s.setViewport);
  // Note: setSelectedControlFrame removed - panels are now persistent
  const frameW = useGenerationStore((s) => s.width);
  const frameH = useGenerationStore((s) => s.height);
  const canvasMode = useCanvasStore((s) => s.canvasMode);
  const focusedFrameId = useCanvasStore((s) => s.focusedFrameId);
  const focusFitTrigger = useCanvasStore((s) => s.focusFitTrigger);
  const activeInputFrameId = useCanvasStore((s) => s.activeInputFrameId);
  const visible = useKeepAliveVisible();

  const panZoom = usePanZoom({
    stageRef,
    viewport: mainViewport,
    canGesture: canvasCanGesture,
    onGesture: canvasOnGesture,
    enabled: visible,
  });
  const maskPaint = useMaskPaint({ stageRef, spaceHeld: panZoom.spaceHeld, layout });
  const imageTransform = useImageTransform(stageRef, trRef);

  const { outputX, processedX, showProcessedFrame, controlFrames, totalBounds, displayScale } =
    layout;

  // Per-node Konva map, keyed `${frameId}:${layerId}`. Image nodes register
  // from InputFrameLayer and mask nodes from MaskLayer; the Transformer
  // attaches through it so its target is unambiguous across frames.
  const nodeMap = useRef<Map<string, Konva.Image>>(new Map());
  const setNodeRef = useCallback((frameId: string, layerId: string, node: Konva.Image | null) => {
    const key = `${frameId}:${layerId}`;
    if (node) nodeMap.current.set(key, node);
    else nodeMap.current.delete(key);
  }, []);

  // Snap targets the focused Initial frame's bounds in pixel space. Using
  // (frame.x / ds, frame.y / ds) re-expresses the display-space frame
  // origin in pixel-space so it aligns with the per-image x/y which are
  // already in pixel-space relative to that origin.
  const focusedInitial = layout.inputFrames.find(
    (f): f is InitialFramePosition => f.kind === "initial" && f.frameId === activeInputFrameId,
  );
  const snap = useSnap(
    focusedInitial?.frameW ?? 0,
    focusedInitial?.frameH ?? 0,
    trRef,
    focusedInitial ? focusedInitial.x / displayScale : 0,
    focusedInitial ? focusedInitial.y / displayScale : 0,
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

  // Defensive remeasure on KeepAlive reveal. Modern browsers fire the
  // ResizeObserver naturally on display:none -> visible transitions, but the
  // explicit read closes any race where the observer is late and the auto-fit
  // effect would otherwise skip with 0x0 dimensions.
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
            <ControlFrameLayer frames={controlFrames} onPickImage={onPickImage} />

            {/* InputFrameLayer renders all Input frames (Initial + Reference)
              as canvas-native chrome and owns per-frame image-layer
              interaction (drag, scale, rotate, select) plus the Transformer
              attach logic. Masks and paint strokes render on MaskLayer above
              it; the cursor, Transformer and snap guides on ChromeLayer. */}
            <InputFrameLayer
              frames={layout.inputFrames}
              displayScale={displayScale}
              trRef={trRef}
              nodeMap={nodeMap}
              setNodeRef={setNodeRef}
              snap={snap}
              onPickInputFile={onPickInputFile}
              onAddReferenceChild={onAddReferenceChild}
            />

            <MaskLayer
              frames={layout.inputFrames}
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
              <ProcessedCompositeLayer
                offsetX={processedX}
                width={layout.outputDisplayW}
                height={layout.outputDisplayH}
              />
            )}

            <ChromeLayer
              focusedFrame={focusedInitial}
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
