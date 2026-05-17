import { useCallback, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useCanvasStore } from "@/stores/canvasStore";
import type { ReferenceFramePosition } from "@/canvas/useControlFrameLayout";
import { FILMSTRIP_SLOT_GAP } from "@/canvas/useControlFrameLayout";
import { fileToBase64 } from "@/lib/image";
import { ReferenceSlot } from "./ReferenceSlot";
import { ReferenceAddSlot } from "./ReferenceAddSlot";

/**
 * DOM overlay layer for the Reference filmstrip. Positions one ReferenceSlot
 * per layout.referenceFrames entry over the Konva-rendered images, plus a
 * trailing AddSlot for new uploads.
 *
 * Two interaction systems coexist:
 *
 * - **Slot reorder**: dnd-kit Sortable - pointer-driven, lifts the dragged
 * slot with a transform, animates siblings, drops via reorderReferenceInput.
 * - **File drop**: HTML5 DataTransfer - drop onto a slot replaces; drop onto
 * AddSlot or the filmstrip background appends.
 *
 * Reads referenceInputs and drag state from canvasStore; dispatches the
 * matching mutations directly.
 */
interface ReferenceFilmstripOverlayProps {
  frames: ReferenceFramePosition[];
  /** Display height for all slots (matches REFERENCE_HEIGHT in single-row mode). */
  height: number;
  /** Cap from the active model (CloudModel.max_images). When set and
   * referenceInputs.length is at or above this number, the AddSlot is hidden
   * so the user can't pile on more refs than the provider will accept.
   * sdnext-side soft pre-flight (cloud_image_count_validation) is the
   * authoritative gate. */
  maxImages?: number | null;
}

export function ReferenceFilmstripOverlay({
  frames,
  height,
  maxImages,
}: ReferenceFilmstripOverlayProps) {
  const referenceInputs = useCanvasStore((s) => s.referenceInputs);
  const appendReferenceInput = useCanvasStore((s) => s.appendReferenceInput);
  const replaceReferenceInput = useCanvasStore((s) => s.replaceReferenceInput);
  const removeReferenceInput = useCanvasStore((s) => s.removeReferenceInput);
  const reorderReferenceInput = useCanvasStore((s) => s.reorderReferenceInput);
  const setDraggingReference = useCanvasStore((s) => s.setDraggingReference);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // PointerSensor activation distance: 4px so a click-without-drag still
  // bubbles to slot interactions (e.g. focus) without registering as a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleFileToReference = useCallback(
    async (file: File): Promise<void> => {
      if (!file.type.startsWith("image/")) return;
      const base64 = await fileToBase64(file);
      const objectUrl = URL.createObjectURL(file);
      const img = new window.Image();
      img.src = objectUrl;
      await new Promise<void>((r) => {
        img.onload = () => r();
      });
      appendReferenceInput(file, base64, objectUrl, img.naturalWidth, img.naturalHeight);
    },
    [appendReferenceInput],
  );

  const handleReplaceWithFile = useCallback(
    async (slotId: string, file: File): Promise<void> => {
      if (!file.type.startsWith("image/")) return;
      const base64 = await fileToBase64(file);
      const objectUrl = URL.createObjectURL(file);
      const img = new window.Image();
      img.src = objectUrl;
      await new Promise<void>((r) => {
        img.onload = () => r();
      });
      replaceReferenceInput(slotId, file, base64, objectUrl, img.naturalWidth, img.naturalHeight);
    },
    [replaceReferenceInput],
  );

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files) {
        for (const file of files) {
          await handleFileToReference(file);
        }
      }
      e.target.value = "";
    },
    [handleFileToReference],
  );

  const handleAddSlotDrop = useCallback(
    (files: File[]) => {
      for (const file of files) void handleFileToReference(file);
    },
    [handleFileToReference],
  );

  const handleDragStart = useCallback(
    (e: DragStartEvent) => {
      setDraggingReference(e.active.id as string);
    },
    [setDraggingReference],
  );

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      setDraggingReference(null);
      if (!e.over || e.active.id === e.over.id) return;
      const fromIndex = referenceInputs.findIndex((r) => r.id === e.active.id);
      const toIndex = referenceInputs.findIndex((r) => r.id === e.over!.id);
      if (fromIndex < 0 || toIndex < 0) return;
      reorderReferenceInput(fromIndex, toIndex);
    },
    [referenceInputs, reorderReferenceInput, setDraggingReference],
  );

  // Empty state: only the wide AddSlot renders.
  if (frames.length === 0) {
    return (
      <div className="pointer-events-auto absolute" style={{ left: 0, top: 0, height }}>
        <ReferenceAddSlot
          empty
          height={height}
          onPick={openFilePicker}
          onFilesDropped={handleAddSlotDrop}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => void handleFileInputChange(e)}
          className="hidden"
        />
      </div>
    );
  }

  // Position the AddSlot just past the last frame's right edge.
  const lastFrame = frames[frames.length - 1];
  const addSlotX = lastFrame.x + lastFrame.displayW + FILMSTRIP_SLOT_GAP;
  const atCapacity = maxImages != null && referenceInputs.length >= maxImages;

  const slotIds = referenceInputs.map((r) => r.id);

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <SortableContext items={slotIds} strategy={horizontalListSortingStrategy}>
        {frames.map((frame, i) => {
          const ref = referenceInputs.find((r) => r.id === frame.refId);
          if (!ref) return null;
          return (
            <SortableSlotWrapper
              key={frame.refId}
              frame={frame}
              filename={ref.filename}
              index={i + 1}
              onRemove={() => removeReferenceInput(frame.refId)}
              onReplaceWithFile={(file) => void handleReplaceWithFile(frame.refId, file)}
            />
          );
        })}
      </SortableContext>
      {!atCapacity && (
        <div className="pointer-events-auto absolute" style={{ left: addSlotX, top: 0, height }}>
          <ReferenceAddSlot
            height={height}
            onPick={openFilePicker}
            onFilesDropped={handleAddSlotDrop}
          />
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => void handleFileInputChange(e)}
        className="hidden"
      />
    </DndContext>
  );
}

interface SortableSlotWrapperProps {
  frame: ReferenceFramePosition;
  filename: string;
  index: number;
  onRemove: () => void;
  onReplaceWithFile: (file: File) => void;
}

/**
 * Per-slot wrapper that binds dnd-kit's useSortable to a ReferenceSlot.
 * Owns the slot's absolute positioning and file-drop handler. During drag,
 * dnd-kit transforms override the static left/top with translate.
 */
function SortableSlotWrapper({
  frame,
  filename,
  index,
  onRemove,
  onReplaceWithFile,
}: SortableSlotWrapperProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: frame.refId,
  });
  const [isDropTarget, setIsDropTarget] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setIsDropTarget(true);
    }
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDropTarget(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDropTarget(false);
      const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
      if (file) onReplaceWithFile(file);
    },
    [onReplaceWithFile],
  );

  // dnd-kit's CSS.Transform is applied on top of the absolute left/top so the
  // slot can lift and translate during drag without losing its anchor point.
  const dndStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
  };

  const state: "default" | "dragging" | "drop-target" = isDragging
    ? "dragging"
    : isDropTarget
      ? "drop-target"
      : "default";

  return (
    <div
      ref={setNodeRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="pointer-events-auto absolute"
      style={{ left: frame.x, top: frame.y, ...dndStyle }}
      {...attributes}
      {...listeners}
    >
      <ReferenceSlot
        index={index}
        filename={filename}
        width={frame.displayW}
        height={frame.displayH}
        state={state}
        onRemove={onRemove}
      />
    </div>
  );
}
