import { useRef, useEffect, useState, useCallback } from "react";
import { Stage } from "react-konva";
import { useInputStore } from "@/stores/inputStore";
import { useMaskPaint } from "./tools/useMaskPaint";
import { useImageTransform } from "./tools/useImageTransform";
import { useSnap } from "./tools/useSnap";
import { useTransformerTarget } from "./tools/useTransformerTarget";
import { FrameLayer } from "./layers/FrameLayer";
import { MaskLayer } from "./layers/MaskLayer";
import { ChromeLayer } from "./layers/ChromeLayer";
import { OutputLayer } from "./layers/OutputLayer";
import type { CanvasLayout } from "./useCanvasLayout";
import type { ComposedFramePosition } from "@/lib/inputs/layout";
import { CanvasBackground } from "./CanvasBackground";
import { mainCamera } from "./navigation/cameras";
import { useKeepAliveVisible } from "@/components/ui/keep-alive";
import type Konva from "konva";
import "./konvaSetup";

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
  const selectedFrameId = useInputStore((s) => s.selectedFrameId);
  const visible = useKeepAliveVisible();

  // The camera owns the stage's transform; the tools keep their own ref
  const attachStage = useCallback((stage: Konva.Stage | null) => {
    stageRef.current = stage;
    mainCamera.attach(stage);
  }, []);

  const maskPaint = useMaskPaint({ stageRef, camera: mainCamera, layout });
  const imageTransform = useImageTransform(stageRef, visible);

  const { outputX, displayScale } = layout;

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

  // Container-responsive sizing; the camera resizes the stage in the same
  // frame, before React catches up
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const size = { width: entry.contentRect.width, height: entry.contentRect.height };
        mainCamera.measure(size);
        setContainerSize(size);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Remeasure on KeepAlive reveal, in case the observer reports late
  useEffect(() => {
    if (!visible) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const size = { width: rect.width, height: rect.height };
      mainCamera.measure(size);
      setContainerSize(size);
    }
  }, [visible]);

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
            camera={mainCamera}
          />
          <Stage
            ref={attachStage}
            width={containerSize.width}
            height={containerSize.height}
            onMouseDown={maskPaint.onMouseDown}
            onMouseMove={maskPaint.onMouseMove}
            onMouseUp={maskPaint.onMouseUp}
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
