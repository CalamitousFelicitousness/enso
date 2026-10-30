import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMediaSrc } from "@/hooks/useMediaSrc";
import { WORDS_FROM } from "./OutputTrash";

interface ResultImageProps {
  /** Durable output URL, data URI, blob URL, or raw base64. */
  image: string;
  alt: string;
  className?: string;
  /** The tile's side in px, which sizes the placeholder; none for a large view. */
  size?: number;
}

/**
 * A stored result's image, with a placeholder for sources that no longer
 * resolve: entries recorded before durable output URLs whose job row has been
 * swept, files the user deleted, and staged unsaved outputs past their TTL.
 * A broken-image glyph reads as a bug; this reads as a fact about the file.
 */
export function ResultImage({ image, alt, className, size }: ResultImageProps) {
  const media = useMediaSrc(image);

  if (media.failed) {
    return (
      <div
        title={`${alt} - source no longer available`}
        className={cn(
          "flex h-full w-full flex-col items-center justify-center gap-1 bg-muted/40 text-muted-foreground",
          className,
        )}
      >
        <ImageOff className={size !== undefined && size < 48 ? "size-3" : "size-4"} aria-hidden />
        {(size === undefined || size >= WORDS_FROM) && (
          <span className="text-3xs leading-none">Unavailable</span>
        )}
      </div>
    );
  }

  return <img src={media.src} alt={alt} className={className} onError={media.onError} />;
}
