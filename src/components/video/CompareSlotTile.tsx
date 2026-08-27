import { Film, X } from "lucide-react";
import { cn, resolveImageSrc } from "@/lib/utils";
import { resultMeta } from "@/lib/video/resultLabel";
import type { VideoResult } from "@/api/types/video";
import type { CompareSlot } from "@/stores/videoStore";

interface CompareSlotTileProps {
  slot: CompareSlot;
  result: VideoResult | null;
  height: number;
  onClear: () => void;
}

/** One side of the comparison: what is loaded, or an outline saying it is not. */
export function CompareSlotTile({ slot, result, height, onClear }: CompareSlotTileProps) {
  const width = Math.round(height * (16 / 9));

  if (!result) {
    return (
      <div
        style={{ width, height }}
        className="flex flex-shrink-0 items-center justify-center rounded border-2 border-dashed border-border text-2xs text-muted-foreground"
      >
        {slot}
      </div>
    );
  }

  return (
    <div
      style={{ width, height }}
      title={resultMeta(result).join(" - ")}
      className={cn(
        "group relative flex-shrink-0 overflow-hidden rounded border-2 border-primary/60",
      )}
    >
      {result.thumbnailUrl ? (
        <img
          src={resolveImageSrc(result.thumbnailUrl)}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-muted/40 text-muted-foreground">
          <Film className="size-3.5" aria-hidden />
        </div>
      )}
      <span className="absolute top-0 left-0 bg-primary px-1 text-4xs leading-tight font-bold text-primary-foreground">
        {slot}
      </span>
      <button
        type="button"
        onClick={onClear}
        title={`Clear ${slot}`}
        className="absolute top-0 right-0 rounded-bl bg-black/60 p-0.5 text-white/70 opacity-0 transition-opacity group-hover:opacity-100 hover:text-white"
      >
        <X size={10} />
      </button>
    </div>
  );
}
