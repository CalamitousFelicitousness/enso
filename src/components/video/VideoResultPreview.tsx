import { createPortal } from "react-dom";
import { Film } from "lucide-react";
import { resolveImageSrc } from "@/lib/utils";
import { resultMeta } from "@/lib/video/resultLabel";
import type { VideoResult } from "@/api/types/video";

interface VideoResultPreviewProps {
  result: VideoResult;
  anchorRect: DOMRect;
}

/** Poster at a readable size plus the facts that separate two takes. The
 * clip itself stays in the player: decoding a second video under the cursor
 * competes with the one the user is watching. */
export function VideoResultPreview({ result, anchorRect }: VideoResultPreviewProps) {
  const meta = resultMeta(result);

  return createPortal(
    <div
      style={{
        position: "fixed",
        left: anchorRect.left + anchorRect.width / 2,
        top: anchorRect.top - 8,
        transform: "translate(-50%, -100%)",
        zIndex: 60,
        pointerEvents: "none",
      }}
      className="flex flex-col items-center"
    >
      <div className="overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
        {result.thumbnailUrl ? (
          <img
            src={resolveImageSrc(result.thumbnailUrl)}
            alt=""
            className="max-h-64 w-64 bg-black object-contain"
          />
        ) : (
          <div className="flex h-36 w-64 items-center justify-center bg-black/60 text-muted-foreground">
            <Film className="size-6" aria-hidden />
          </div>
        )}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-2 py-1 text-3xs text-muted-foreground">
          {meta.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
