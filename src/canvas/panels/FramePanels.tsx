// The DOM chrome over the canvas: a dock per frame inside one sortable
// context for frame reorder, the add buttons under each column, the Output
// dock, and the processed hats.

import { useMemo } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { useInputStore } from "@/stores/inputStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useOutline } from "@/inputs/useOutline";
import { positionLabel } from "@/lib/inputs/text";
import type { CanvasLayout } from "@/canvas/useCanvasLayout";
import { INPUTS_FULL_HINT } from "@/canvas/useInputsAtCapacity";
import { useSizeSourceMark } from "@/canvas/useSizeSource";
import { resolveOutputSize } from "@/lib/sizeCompute";
import { FrameDock } from "./FrameDock";
import { OutputFramePanel } from "./OutputFramePanel";
import { ProcessedHat } from "./ProcessedHat";
import type { ViewportState } from "@/canvas/viewportBus";

interface FramePanelsProps {
  layout: CanvasLayout;
  viewport: ViewportState;
  labelScale: number;
  /** Open the file picker scoped to a composed frame. */
  onPickImage?: (frameId: string) => void;
  /** Open the file picker scoped to a set frame's +Add cell. */
  onAddCell?: (frameId: string) => void;
  /** Drop all content in a frame. */
  onClearFrame?: (frameId: string) => void;
  /** Remove a frame from its column. */
  onRemoveFrame?: (frameId: string) => void;
  /** Add an Initial frame at the end of the list. */
  onAddInputFrame?: () => void;
  /** Add a Control frame at the end of the list. */
  onAddControlFrame?: () => void;
}

export function FramePanels({
  layout,
  viewport,
  labelScale,
  onPickImage,
  onAddCell,
  onClearFrame,
  onRemoveFrame,
  onAddInputFrame,
  onAddControlFrame,
}: FramePanelsProps) {
  const outline = useOutline();
  const moveFrame = useInputStore((s) => s.moveFrame);
  const hiresEnabled = useGenerationStore((s) => s.hiresEnabled);
  const hiresScale = useGenerationStore((s) => s.hiresScale);
  const hiresResizeX = useGenerationStore((s) => s.hiresResizeX);
  const hiresResizeY = useGenerationStore((s) => s.hiresResizeY);
  const sizeMultiple = useCanvasStore((s) => s.sizeMultiple);

  // PointerSensor activation distance of 4px so a click without drag
  // bubbles to the dock itself instead of starting a frame reorder.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const sizeSource = useSizeSourceMark(outline.sent.length);

  const handleDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const fromIndex = outline.entries.findIndex((f) => f.frameId === e.active.id);
    const toIndex = outline.entries.findIndex((f) => f.frameId === e.over!.id);
    if (fromIndex < 0 || toIndex < 0) return;
    moveFrame(fromIndex, toIndex);
  };

  const canRemove = outline.entries.length > 1;
  const frameIds = layout.frames.map((f) => f.frameId);
  const { genSize, displayW } = layout;
  const genSizeText = `${genSize.width}×${genSize.height}`;
  const outputSize = resolveOutputSize(
    genSize,
    hiresEnabled,
    hiresScale,
    hiresResizeX,
    hiresResizeY,
    sizeMultiple,
  );
  const outputSizeText = `${outputSize.width}×${outputSize.height}`;

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <SortableContext items={frameIds} strategy={verticalListSortingStrategy}>
        {layout.frames.map((frame) => {
          const entry = outline.entries.find((e) => e.frameId === frame.frameId);
          if (!entry) return null;
          return (
            <FrameDock
              key={frame.frameId}
              frame={frame}
              entry={entry}
              viewport={viewport}
              labelScale={labelScale}
              genSize={genSize}
              onPickImage={onPickImage}
              onAddCell={onAddCell}
              onClearFrame={onClearFrame}
              onRemoveFrame={onRemoveFrame}
              canRemove={canRemove}
              atCapacity={layout.inputsAtCapacity}
              sizeSource={sizeSource?.frameId === frame.frameId ? sizeSource : null}
            />
          );
        })}
      </SortableContext>

      {/* The processed map under each Control frame that has one */}
      {layout.frames.map((frame) =>
        frame.kind === "composed" && frame.processedY !== null ? (
          <ControlProcessedHat
            key={`processed-${frame.frameId}`}
            frameId={frame.frameId}
            position={outline.entries.find((e) => e.frameId === frame.frameId)?.position ?? 0}
            canvasX={frame.x}
            canvasY={frame.processedY}
            frameW={frame.displayW}
            viewport={viewport}
            labelScale={labelScale}
          />
        ) : null,
      )}

      {onAddInputFrame && (
        <AddFrameButton
          x={0}
          y={layout.inputColumnBottom}
          width={displayW}
          viewport={viewport}
          labelScale={labelScale}
          disabled={layout.inputsAtCapacity}
          title={layout.inputsAtCapacity ? INPUTS_FULL_HINT : undefined}
          label="Add Input Frame"
          onClick={onAddInputFrame}
        />
      )}
      {onAddControlFrame && (
        <AddFrameButton
          x={layout.controlColumnX}
          y={layout.controlColumnBottom}
          width={displayW}
          viewport={viewport}
          labelScale={labelScale}
          disabled={false}
          label="Add Control Frame"
          onClick={onAddControlFrame}
        />
      )}

      <OutputFramePanel
        canvasX={layout.outputX}
        viewport={viewport}
        frameW={layout.outputDisplayW}
        labelScale={labelScale}
        sizeText={outputSizeText}
      />

      {layout.showProcessedFrame && (
        <CompositeProcessedHat
          canvasX={layout.processedX}
          frameW={layout.outputDisplayW}
          viewport={viewport}
          labelScale={labelScale}
          sizeText={genSizeText}
        />
      )}
    </DndContext>
  );
}

/** The hat of a Control frame's own processed map. */
function ControlProcessedHat({
  frameId,
  position,
  ...rest
}: {
  frameId: string;
  position: number;
  canvasX: number;
  canvasY: number;
  frameW: number;
  viewport: ViewportState;
  labelScale: number;
}) {
  const blob = useInputStore(
    (s) => s.frames.find((f) => f.id === frameId)?.processed?.blob ?? null,
  );
  return <ProcessedHat {...rest} label={`Processed (${positionLabel(position)})`} source={blob} />;
}

/** The hat of the composite beside the output: the last job's, else the first Control frame's map. */
function CompositeProcessedHat(props: {
  canvasX: number;
  frameW: number;
  viewport: ViewportState;
  labelScale: number;
  sizeText: string;
}) {
  const processedUrl = useCanvasStore((s) => s.processedUrl);
  const firstMap = useInputStore(
    (s) =>
      s.frames.find((f) => f.role === "control" && f.enabled && f.processed?.blob)?.processed
        ?.blob ?? null,
  );
  return <ProcessedHat {...props} source={processedUrl ?? firstMap} />;
}

interface AddFrameButtonProps {
  /** Display-space anchor: the button sits just below the column's last frame. */
  x: number;
  y: number;
  width: number;
  viewport: ViewportState;
  labelScale: number;
  disabled: boolean;
  title?: string | undefined;
  label: string;
  onClick: () => void;
}

function AddFrameButton({
  x,
  y,
  width,
  viewport,
  labelScale,
  disabled,
  title,
  label,
  onClick,
}: AddFrameButtonProps) {
  const combinedScale = viewport.scale * labelScale;
  const style = useMemo<React.CSSProperties>(() => {
    const screenX = x * viewport.scale + viewport.x;
    const screenY = y * viewport.scale + viewport.y;
    return {
      position: "absolute",
      left: `${screenX}px`,
      top: `${screenY}px`,
      width: `${width}px`,
      transform: `scale(${combinedScale})`,
      transformOrigin: "top left",
      pointerEvents: "auto",
    };
  }, [x, y, width, viewport.scale, viewport.x, viewport.y, combinedScale]);

  return (
    <div style={style} className="z-50">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-white/15 bg-white/[0.02] px-3 py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:border-white/30 hover:bg-white/[0.04] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-white/15 disabled:hover:bg-white/[0.02] disabled:hover:text-muted-foreground"
      >
        <Plus size={14} />
        {label}
      </button>
    </div>
  );
}
