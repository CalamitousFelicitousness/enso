import { useCallback, useState } from "react";
import { toast } from "sonner";
import { nothingUsedText } from "@/lib/recipes/text";
import {
  ENTRY_MIME,
  IMAGE_MIME,
  readPayload,
  type EntryPayload,
  type ImagePayload,
} from "@/lib/drag";

interface UseDropTargetOptions {
  /** A picture dragged from a result or the gallery. */
  onDropImage?: (payload: ImagePayload, e: React.DragEvent) => void;
  /** A library entry. A target without this refuses entries while they are dragged. */
  onDropEntry?: (payload: EntryPayload, e: React.DragEvent) => void;
  /** The first accepted file. Ignored when onFilesDrop is given. */
  onFileDrop?: (file: File, e: React.DragEvent) => void;
  /** Every accepted file, in the order the drag carried them. */
  onFilesDrop?: (files: File[], e: React.DragEvent) => void;
  /** What the target takes. Drops only: pasted files often have no usable
   * name, so the paste path stays on MIME. */
  acceptFile?: (file: File) => boolean;
  /** What the target takes, for the words when a drop holds none of it. */
  kinds?: string;
  /** A drop of files the target does not take; without it the drop is said in a toast. */
  onRefused?: (files: File[], e: React.DragEvent) => void;
}

const isImageFile = (file: File) => file.type.startsWith("image/");

/** A drop target that takes what it has a handler for: an app drag by the
 * type it travels under, files from outside. Anything else is refused while
 * it is dragged, with the no-drop cursor. */
export function useDropTarget({
  onDropImage,
  onDropEntry,
  onFileDrop,
  onFilesDrop,
  acceptFile,
  kinds = "pictures",
  onRefused,
}: UseDropTargetOptions) {
  const [isOver, setIsOver] = useState(false);
  const takesFiles = onFilesDrop !== undefined || onFileDrop !== undefined;

  const takes = useCallback(
    (e: React.DragEvent) => {
      const { types } = e.dataTransfer;
      if (types.includes(ENTRY_MIME)) return onDropEntry !== undefined;
      if (types.includes(IMAGE_MIME)) return onDropImage !== undefined;
      return takesFiles && types.includes("Files");
    },
    [onDropEntry, onDropImage, takesFiles],
  );

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!takes(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    [takes],
  );

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!takes(e)) return;
      e.preventDefault();
      setIsOver(true);
    },
    [takes],
  );

  const onDragLeave = useCallback((e: React.DragEvent) => {
    // Only deactivate if leaving the target element itself (not a child)
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsOver(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (!takes(e)) return;
      e.preventDefault();
      setIsOver(false);
      const entry = readPayload(e.dataTransfer.getData(ENTRY_MIME));
      if (entry?.type === "library-entry") {
        onDropEntry?.(entry, e);
        return;
      }
      const image = readPayload(e.dataTransfer.getData(IMAGE_MIME));
      if (image && image.type !== "library-entry") {
        onDropImage?.(image, e);
        return;
      }
      const dropped = Array.from(e.dataTransfer.files ?? []);
      const files = dropped.filter(acceptFile ?? isImageFile);
      if (files.length === 0) {
        if (onRefused) onRefused(dropped, e);
        else toast.info(nothingUsedText("drop", kinds));
        return;
      }
      if (onFilesDrop) onFilesDrop(files, e);
      else if (files[0]) onFileDrop?.(files[0], e);
    },
    [takes, onDropEntry, onDropImage, onFilesDrop, onFileDrop, acceptFile, kinds, onRefused],
  );

  return { onDragOver, onDragEnter, onDragLeave, onDrop, isOver };
}
