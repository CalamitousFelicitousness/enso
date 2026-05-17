import { memo, useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Compact dashed-border drop affordance at the end of the Reference filmstrip.
 * Two visual variants:
 *
 * - default: 64px wide, vertical "Add" label, used when slots exist
 * - empty: 180px wide with icon + "Add reference" + "drop image or click"
 * subtext, used as the sole filmstrip element when no refs yet
 *
 * Click opens a file picker; drag-over highlights border and brightens fill;
 * drop dispatches onPick with the dragged files.
 */
export interface ReferenceAddSlotProps {
  /** True when this is the only filmstrip element (no refs yet). Wider visual + sublabel. */
  empty?: boolean;
  /** Slot height in display pixels (matches sibling slot height). */
  height: number;
  /** Open the OS file picker. Parent owns the dispatch to canvasStore.appendReferenceInput. */
  onPick?: () => void;
  /** Files dropped from desktop onto this slot. Parent dispatches append. */
  onFilesDropped?: (files: File[]) => void;
}

export const ReferenceAddSlot = memo(function ReferenceAddSlot({
  empty = false,
  height,
  onPick,
  onFilesDropped,
}: ReferenceAddSlotProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
      if (files.length > 0 && onFilesDropped) onFilesDropped(files);
    },
    [onFilesDropped],
  );

  return (
    <button
      type="button"
      aria-label="Add reference image"
      onClick={onPick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        width: empty ? 180 : 64,
        height,
        borderColor: isDragOver ? "var(--reference)" : "oklch(from var(--reference) l c h / 0.55)",
        backgroundColor: isDragOver
          ? "oklch(from var(--reference) l c h / 0.12)"
          : "oklch(from var(--card) l c h / 0.4)",
        color: isDragOver ? "var(--reference)" : "oklch(from var(--reference) l c h / 0.9)",
      }}
      className={cn(
        "group relative flex shrink-0 cursor-pointer items-center justify-center gap-2 border border-dashed bg-transparent transition-[background-color,border-color,color] duration-180 ease-out",
        empty ? "flex-col px-3 text-center" : "flex-col",
        "hover:border-[var(--reference)] hover:bg-[oklch(from_var(--reference)_l_c_h_/_0.08)] hover:text-[var(--reference)]",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--reference)]",
      )}
    >
      <span
        className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-[2px] border"
        style={{
          borderColor: "oklch(from var(--reference) l c h / 0.5)",
          backgroundColor: "oklch(from var(--reference) l c h / 0.08)",
        }}
      >
        <Plus size={12} strokeWidth={2} />
      </span>
      {empty ? (
        <>
          <div className="font-mono text-3xs uppercase tracking-[0.08em]">Add reference</div>
          <div
            className="font-mono text-3xs"
            style={{ color: "oklch(from var(--reference) l c h / 0.55)" }}
          >
            drop image or click
          </div>
        </>
      ) : (
        <span
          className="font-mono text-3xs uppercase tracking-[0.12em]"
          style={{
            color: "oklch(from var(--reference) l c h / 0.75)",
            writingMode: "vertical-rl",
            textOrientation: "mixed",
            transform: "rotate(180deg)",
          }}
        >
          Add
        </span>
      )}
    </button>
  );
});
