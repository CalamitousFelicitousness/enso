// The DOM chrome over the canvas: a dock per frame inside one sortable
// context for frame reorder, the Add frame control under the input column,
// and the Output dock.

import { sizeText } from "@/lib/media/text";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { useCanvasStore } from "@/stores/canvasStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useOutlineWithEnv } from "@/inputs/useOutline";
import { moveFrame } from "@/inputs/edits";
import { saveFrames } from "@/inputs/library";
import type { CanvasLayout } from "@/canvas/useCanvasLayout";
import { useSizeSourceMark } from "@/canvas/useSizeSource";
import { resolveOutputSize } from "@/lib/sizeCompute";
import { FrameDock } from "./FrameDock";
import { OutputFramePanel } from "./OutputFramePanel";
import { AddFrameMenu } from "@/components/generation/tabs/input/AddFrameMenu";
import type { ViewportState } from "@/canvas/viewportBus";
import type { ControlType } from "@/lib/inputs/types";
import { useWorldChrome } from "@/canvas/navigation/chrome";

interface FramePanelsProps {
  layout: CanvasLayout;
  labelScale: number;
  /** Open the file picker scoped to a composed frame. */
  onPickImage?: (frameId: string) => void;
  /** Open the file picker scoped to a set frame's +Add cell. */
  onAddCell?: (frameId: string) => void;
  /** Drop all content in a frame. */
  onClearFrame?: (frameId: string) => void;
  /** Remove a frame from its column. */
  onRemoveFrame?: (frameId: string) => void;
}

export function FramePanels({
  layout,
  labelScale,
  onPickImage,
  onAddCell,
  onClearFrame,
  onRemoveFrame,
}: FramePanelsProps) {
  // The committed camera: only the chrome re-renders when a move settles
  const viewport = useCanvasStore((s) => s.viewport);
  const { outline, env } = useOutlineWithEnv();
  // Saving reads the facts the canvas shows maps by, as they are when it runs
  const envRef = useRef(env);
  useEffect(() => {
    envRef.current = env;
  }, [env]);
  const saveFrame = useCallback((frameId: string) => {
    void saveFrames(envRef.current, [frameId]);
  }, []);
  const hiresEnabled = useGenerationStore((s) => s.hiresEnabled);
  const hiresScale = useGenerationStore((s) => s.hiresScale);
  const hiresResizeX = useGenerationStore((s) => s.hiresResizeX);
  const hiresResizeY = useGenerationStore((s) => s.hiresResizeY);
  const sizeMultiple = useCanvasStore((s) => s.sizeMultiple);

  // PointerSensor activation distance of 4px so a click without drag
  // bubbles to the dock itself instead of starting a frame reorder.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const sizeSource = useSizeSourceMark(outline.sent.length);
  const editingFrameId = useCanvasStore((s) => s.editingFrameId);

  // Edit mode ends with the frame's processor, or the frame
  useEffect(() => {
    if (!editingFrameId) return;
    const edited = outline.entries.find((e) => e.frameId === editingFrameId);
    if (!edited || edited.maps.length === 0) useCanvasStore.getState().setEditingFrame(null);
  }, [editingFrameId, outline]);

  const handleDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const fromIndex = outline.entries.findIndex((f) => f.frameId === e.active.id);
    const toIndex = outline.entries.findIndex((f) => f.frameId === e.over!.id);
    if (fromIndex < 0 || toIndex < 0) return;
    moveFrame(fromIndex, toIndex);
  };

  const canRemove = outline.entries.length > 1;
  const frameIds = layout.frames.map((f) => f.frameId);
  const { genSize } = layout;
  const outputSize =
    layout.outputPicture ??
    resolveOutputSize(genSize, hiresEnabled, hiresScale, hiresResizeX, hiresResizeY, sizeMultiple);
  const outputSizeText = sizeText(outputSize);

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
              onSaveFrame={saveFrame}
              canRemove={canRemove}
              atCapacity={layout.inputsAtCapacity}
              sizeSource={sizeSource?.frameId === frame.frameId ? sizeSource : null}
            />
          );
        })}
      </SortableContext>

      <AddFrameControl
        x={layout.inputColumnX}
        y={layout.inputColumnBottom}
        viewport={viewport}
        labelScale={labelScale}
        lockedType={outline.controls[0]?.settings.type ?? null}
      />

      <OutputFramePanel
        canvasX={layout.outputX}
        viewport={viewport}
        frameW={layout.outputDisplayW}
        labelScale={labelScale}
        sizeText={outputSizeText}
      />
    </DndContext>
  );
}

interface AddFrameControlProps {
  /** Display-space anchor: just below the input column's last frame. */
  x: number;
  y: number;
  viewport: ViewportState;
  labelScale: number;
  lockedType: ControlType | null;
}

/** The one place the canvas adds a frame from; the role picked decides its column. */
function AddFrameControl({ x, y, viewport, labelScale, lockedType }: AddFrameControlProps) {
  const combinedScale = viewport.scale * labelScale;
  const rootRef = useRef<HTMLDivElement>(null);
  useWorldChrome("add", rootRef, { x, y, edge: "top", scale: labelScale });
  const style = useMemo<React.CSSProperties>(
    () => ({
      position: "absolute",
      left: `${x * viewport.scale + viewport.x}px`,
      top: `${y * viewport.scale + viewport.y}px`,
      transform: `scale(${combinedScale})`,
      transformOrigin: "top left",
      pointerEvents: "auto",
    }),
    [x, y, viewport.scale, viewport.x, viewport.y, combinedScale],
  );

  return (
    <div ref={rootRef} style={style} className="z-50 pt-2">
      <AddFrameMenu lockedType={lockedType}>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground data-[state=open]:bg-white/[0.06] data-[state=open]:text-foreground"
        >
          <Plus size={13} />
          Add frame
        </button>
      </AddFrameMenu>
    </div>
  );
}
