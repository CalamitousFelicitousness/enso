// Orchestrator for the per-Input-frame DOM panels. Maps the layout's
// inputFrames array to N InputFramePanel components, wraps in a
// DndContext + verticalListSortingStrategy SortableContext (
// wires onDragEnd; leaves it as a no-op), and renders the
// +Add Input Frame placeholder at the bottom of the input column.
//
// commits this file without mounting it in CanvasView; 
// adds the <InputFramePanels /> mount and drops the legacy
// ReferenceFilmstripOverlay + ControlFramePanels InputFramePanel mount.

import { useMemo } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { useCanvasStore } from "@/stores/canvasStore";
import { enumerateWireSlots } from "@/canvas/inputFrames";
import type { CanvasLayout } from "@/canvas/useControlFrameLayout";
import { InputFramePanel } from "./InputFramePanel";

interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

interface InputFramePanelsProps {
  layout: CanvasLayout;
  viewport: ViewportState;
  labelScale: number;
  /** Open the file picker scoped to a frame's Initial drop target. */
  onPickImage?: (frameId: string) => void;
  /** Open the file picker scoped to a Reference frame's +Add cell. */
  onAddReferenceChild?: (frameId: string) => void;
  /** Drop all content in a frame (layers + mask + references). */
  onClearFrame?: (frameId: string) => void;
  /** Remove a frame from the input column entirely. */
  onRemoveFrame?: (frameId: string) => void;
  /** Add a new Input frame at the end of the column. wires
   * default-mode + drag-onto-empty-canvas semantics; leaves a
   * placeholder button. */
  onAddInputFrame?: () => void;
}

export function InputFramePanels({
  layout,
  viewport,
  labelScale,
  onPickImage,
  onAddReferenceChild,
  onClearFrame,
  onRemoveFrame,
  onAddInputFrame,
}: InputFramePanelsProps) {
  const storeFrames = useCanvasStore((s) => s.inputFrames);
  const reorderInputFrames = useCanvasStore((s) => s.reorderInputFrames);

  // PointerSensor activation distance of 4px so a click without drag
  // bubbles to the panel itself (focus, button clicks, etc.) instead of
  // accidentally triggering a frame reorder.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Wire indices flatten across all frames; compute once per render so
  // each panel reads its slot's globalIndex via a single Map lookup.
  const wireIndexByFrame = useMemo(() => {
    const slots = enumerateWireSlots(storeFrames);
    const map = new Map<string, number>();
    for (const slot of slots) {
      // First slot in the frame wins (Reference frames have N slots; only
      // the first sets the panel label index).
      if (!map.has(slot.frameId)) map.set(slot.frameId, slot.globalIndex);
    }
    return map;
  }, [storeFrames]);

  const handleDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const fromIndex = storeFrames.findIndex((f) => f.id === e.active.id);
    const toIndex = storeFrames.findIndex((f) => f.id === e.over!.id);
    if (fromIndex < 0 || toIndex < 0) return;
    reorderInputFrames(fromIndex, toIndex);
  };

  const canRemove = storeFrames.length > 1;
  const frameIds = layout.inputFrames.map((f) => f.frameId);

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <SortableContext items={frameIds} strategy={verticalListSortingStrategy}>
        {layout.inputFrames.map((frame) => (
          <InputFramePanel
            key={frame.frameId}
            frame={frame}
            wireIndex={wireIndexByFrame.get(frame.frameId) ?? null}
            viewport={viewport}
            labelScale={labelScale}
            genSize={layout.genSize}
            onPickImage={onPickImage}
            onAddReferenceChild={onAddReferenceChild}
            onClearFrame={onClearFrame}
            onRemoveFrame={onRemoveFrame}
            canRemove={canRemove}
          />
        ))}
      </SortableContext>
      {onAddInputFrame && (
        <AddInputFrameButton
          y={layout.inputColumnBottom}
          width={layout.displayW}
          viewport={viewport}
          labelScale={labelScale}
          onClick={onAddInputFrame}
        />
      )}
    </DndContext>
  );
}

interface AddInputFrameButtonProps {
  /** Y position in display-space (canvas coords) where the button anchors;
   * sits immediately below the last Input frame. */
  y: number;
  /** Width of the input column in display-space (matches Initial frame
   * width). */
  width: number;
  viewport: ViewportState;
  labelScale: number;
  onClick: () => void;
}

function AddInputFrameButton({
  y,
  width,
  viewport,
  labelScale,
  onClick,
}: AddInputFrameButtonProps) {
  const combinedScale = viewport.scale * labelScale;
  const style = useMemo<React.CSSProperties>(() => {
    const screenX = viewport.x;
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
  }, [y, width, viewport.scale, viewport.x, viewport.y, combinedScale]);

  return (
    <div style={style} className="z-50">
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-white/15 bg-white/[0.02] px-3 py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:border-white/30 hover:bg-white/[0.04] hover:text-foreground"
      >
        <Plus size={14} />
        Add Input Frame
      </button>
    </div>
  );
}
