import { useCallback, useId, useState } from "react";
import { useDragStore, INTERNAL_MIME } from "@/stores/dragStore";
import type { DragPayload } from "@/stores/dragStore";

interface UseDropTargetOptions {
  onDropPayload?: (payload: DragPayload, e: React.DragEvent) => void;
  /** The first accepted file. Ignored when onFilesDrop is given. */
  onFileDrop?: (file: File, e: React.DragEvent) => void;
  /** Every accepted file, in the order the drag carried them. */
  onFilesDrop?: (files: File[], e: React.DragEvent) => void;
  /** What the target takes. Drops only: pasted files often have no usable
   * name, so the paste path stays on MIME. */
  acceptFile?: (file: File) => boolean;
  acceptTypes?: DragPayload["type"][];
}

const isImageFile = (file: File) => file.type.startsWith("image/");

/** Whether a drag carries something a target could take at all. */
function hasDroppableData(e: React.DragEvent) {
  return e.dataTransfer.types.includes(INTERNAL_MIME) || e.dataTransfer.types.includes("Files");
}

export function useDropTarget({
  onDropPayload,
  onFileDrop,
  onFilesDrop,
  acceptFile,
  acceptTypes,
}: UseDropTargetOptions) {
  const [isOver, setIsOver] = useState(false);
  const targetId = useId();

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!hasDroppableData(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!hasDroppableData(e)) return;
      e.preventDefault();
      setIsOver(true);
      useDragStore.getState().setActiveDropTarget(targetId);
    },
    [targetId],
  );

  const onDragLeave = useCallback(
    (e: React.DragEvent) => {
      // Only deactivate if leaving the target element itself (not a child)
      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
      setIsOver(false);
      const store = useDragStore.getState();
      if (store.activeDropTargetId === targetId) {
        store.setActiveDropTarget(null);
      }
    },
    [targetId],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsOver(false);
      useDragStore.getState().setActiveDropTarget(null);

      // Check for internal drag payload first
      const raw = e.dataTransfer.getData(INTERNAL_MIME);
      if (raw) {
        try {
          const payload = JSON.parse(raw) as DragPayload;
          if (!acceptTypes || acceptTypes.includes(payload.type)) {
            onDropPayload?.(payload, e);
            useDragStore.getState().endDrag();
            return;
          }
        } catch {
          /* fall through to file handling */
        }
      }

      // Fall through to native file drops
      const files = Array.from(e.dataTransfer.files ?? []).filter(acceptFile ?? isImageFile);
      if (files.length === 0) return;
      if (onFilesDrop) onFilesDrop(files, e);
      else if (files[0]) onFileDrop?.(files[0], e);
    },
    [onDropPayload, onFileDrop, onFilesDrop, acceptFile, acceptTypes],
  );

  return { onDragOver, onDragEnter, onDragLeave, onDrop, isOver };
}
