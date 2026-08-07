import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cn, resolveImageSrc } from "@/lib/utils";

interface ResultImageProps {
  /** Durable output URL, data URI, blob URL, or raw base64. */
  image: string;
  alt: string;
  className?: string;
  /** Drop the caption in tiles too small to fit it. */
  compact?: boolean;
}

/**
 * A stored result's image, with a placeholder for sources that no longer
 * resolve: entries recorded before durable output URLs whose job row has been
 * swept, files the user deleted, and staged unsaved outputs past their TTL.
 * A broken-image glyph reads as a bug; this reads as a fact about the file.
 */
export function ResultImage({ image, alt, className, compact }: ResultImageProps) {
  const [failed, setFailed] = useState(false);
  // Reset while rendering rather than in an effect, so a changed image never
  // paints one frame of the previous tile's failure state.
  const [seen, setSeen] = useState(image);
  if (seen !== image) {
    setSeen(image);
    setFailed(false);
  }

  if (failed) {
    return (
      <div
        title={`${alt} - source no longer available`}
        className={cn(
          "flex h-full w-full flex-col items-center justify-center gap-1 bg-muted/40 text-muted-foreground",
          className,
        )}
      >
        <ImageOff className={compact ? "size-3" : "size-4"} aria-hidden />
        {!compact && <span className="text-3xs leading-none">Unavailable</span>}
      </div>
    );
  }

  return (
    <img
      src={resolveImageSrc(image)}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
