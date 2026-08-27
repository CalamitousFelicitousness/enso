import { memo, useRef, useState, type ReactNode } from "react";
import { Film, ImageOff, Pin } from "lucide-react";
import { cn, resolveImageSrc } from "@/lib/utils";
import { DOMAIN_LABELS } from "@/lib/video/resultLabel";
import type { VideoResult } from "@/api/types/video";
import type { CompareSlot } from "@/stores/videoStore";

/** Tiles keep one shape so a row of them scans as a row. */
const ASPECT = 16 / 9;

/** Four 20px buttons need about 96px, which 16:9 reaches at this height. */
const ACTIONS_MIN_HEIGHT = 56;

function Poster({ result }: { result: VideoResult }) {
  const src = result.thumbnailUrl;
  const [failed, setFailed] = useState(false);
  // Reset while rendering, so a recycled tile never paints one frame of the
  // previous result's failure.
  const [seen, setSeen] = useState(src);
  if (seen !== src) {
    setSeen(src);
    setFailed(false);
  }

  if (!src || failed) {
    return (
      <div
        title={src ? "Poster no longer available" : "No poster was saved for this result"}
        className="flex h-full w-full items-center justify-center bg-muted/40 text-muted-foreground"
      >
        {src ? (
          <ImageOff className="size-3.5" aria-hidden />
        ) : (
          <Film className="size-3.5" aria-hidden />
        )}
      </div>
    );
  }

  return (
    <img
      src={resolveImageSrc(src)}
      alt=""
      loading="lazy"
      decoding="async"
      className="h-full w-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}

interface VideoResultTileProps {
  result: VideoResult;
  /** Tile height in px; the width follows from the fixed aspect. */
  height: number;
  selected?: boolean;
  /** Badge shown when the result occupies a compare slot. */
  slot?: CompareSlot | undefined;
  /** Every callback takes the result, so one instance serves every tile and
   * the memo actually holds. */
  onSelect?: (result: VideoResult) => void;
  onActivate?: (result: VideoResult) => void;
  onContextMenu?: (result: VideoResult, e: React.MouseEvent) => void;
  onHoverStart?: (result: VideoResult, rect: DOMRect) => void;
  onHoverEnd?: () => void;
  /** Hover overlay, dropped on tiles too small to host it. */
  actions?: (result: VideoResult) => ReactNode;
}

export const VideoResultTile = memo(function VideoResultTile({
  result,
  height,
  selected,
  slot,
  onSelect,
  onActivate,
  onContextMenu,
  onHoverStart,
  onHoverEnd,
  actions,
}: VideoResultTileProps) {
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      onClick={() => onSelect?.(result)}
      onDoubleClick={() => onActivate?.(result)}
      onContextMenu={(e) => onContextMenu?.(result, e)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.(result);
        }
      }}
      onMouseEnter={() => {
        if (ref.current) onHoverStart?.(result, ref.current.getBoundingClientRect());
      }}
      onMouseLeave={onHoverEnd}
      style={{ width: Math.round(height * ASPECT), height }}
      className={cn(
        "group relative flex-shrink-0 overflow-hidden rounded border-2 transition-colors",
        selected ? "border-primary" : "border-transparent hover:border-muted-foreground/30",
      )}
    >
      <Poster result={result} />

      <span className="absolute bottom-0 left-0 bg-black/60 px-1 text-4xs leading-tight text-white/80">
        {DOMAIN_LABELS[result.domain]}
      </span>
      {result.pinned && (
        <Pin className="absolute top-0.5 right-0.5 size-3 text-primary drop-shadow" aria-hidden />
      )}
      {slot && (
        <span className="absolute top-0 left-0 bg-primary px-1 text-4xs leading-tight font-bold text-primary-foreground">
          {slot}
        </span>
      )}

      {actions && height >= ACTIONS_MIN_HEIGHT && (
        <div className="opacity-0 transition-opacity group-hover:opacity-100">
          {actions(result)}
        </div>
      )}
    </div>
  );
});
