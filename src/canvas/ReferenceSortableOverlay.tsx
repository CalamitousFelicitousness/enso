// Viewport-transformed DOM overlays for a reference grid's child cells: one
// transparent sortable div per Konva cell hosting the dnd-kit drag activator
// and a hover X-remove button. Konva owns the pixels; this owns the gestures.
// Shared by the Input frames (canvasStore) and the video references mother
// frame (videoCanvasStore) - callers translate ids to their store's indices.

import { useMemo, type CSSProperties } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { X } from "lucide-react";
import type { ReferenceChildPosition } from "@/canvas/inputFrameTypes";

interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

interface ReferenceSortableOverlayProps {
  /** Child cells in canvas coordinates (any mother-frame offset applied). */
  cells: ReferenceChildPosition[];
  viewport: ViewportState;
  /** Ids are dnd-kit's currency; the caller maps them to store indices. */
  onReorder: (activeId: string, overId: string) => void;
  onRemove: (refId: string) => void;
  /** Capture-phase pointer-down on any cell (e.g. focusing the slot for paste). */
  onCellPointerDown?: (() => void) | undefined;
}

export function ReferenceSortableOverlay({
  cells,
  viewport,
  onReorder,
  onRemove,
  onCellPointerDown,
}: ReferenceSortableOverlayProps) {
  // 4px activation distance so a click without drag doesn't trigger a reorder.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    onReorder(String(e.active.id), String(e.over.id));
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      {/* Horizontal strategy though the grid wraps - the dnd-kit hit-test
       * doesn't care about visual layout direction. */}
      <SortableContext items={cells.map((c) => c.refId)} strategy={horizontalListSortingStrategy}>
        {cells.map((cell) => (
          <ReferenceCellOverlay
            key={cell.refId}
            cell={cell}
            viewport={viewport}
            onRemove={onRemove}
            onCellPointerDown={onCellPointerDown}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}

interface ReferenceCellOverlayProps {
  cell: ReferenceChildPosition;
  viewport: ViewportState;
  onRemove: (refId: string) => void;
  onCellPointerDown?: (() => void) | undefined;
}

function ReferenceCellOverlay({
  cell,
  viewport,
  onRemove,
  onCellPointerDown,
}: ReferenceCellOverlayProps) {
  // useSortable binds this overlay to the parent SortableContext's items
  // list. Listeners are spread on the overlay wrapper so a pointer-down
  // anywhere on the cell starts a drag; the X button uses stopPropagation
  // so it stays clickable. The focus side-effect rides the capture phase
  // so it never collides with the dnd-kit bubble-phase listener.
  const { attributes, listeners, setNodeRef } = useSortable({ id: cell.refId });

  const style = useMemo<CSSProperties>(() => {
    const left = cell.x * viewport.scale + viewport.x;
    const top = cell.y * viewport.scale + viewport.y;
    const width = cell.displayW * viewport.scale;
    const height = cell.displayH * viewport.scale;
    return {
      position: "absolute",
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
      pointerEvents: "auto",
      cursor: "grab",
      touchAction: "none",
    };
  }, [cell.x, cell.y, cell.displayW, cell.displayH, viewport.scale, viewport.x, viewport.y]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group"
      {...attributes}
      {...listeners}
      onPointerDownCapture={onCellPointerDown}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(cell.refId);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        title="Remove reference"
        className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
        style={{ pointerEvents: "auto" }}
      >
        <X size={10} />
      </button>
    </div>
  );
}
