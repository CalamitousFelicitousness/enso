import { useMemo } from "react";
import { createPortal } from "react-dom";
import type { GenerationResult } from "@/stores/generationStore";
import { ResultImage } from "@/components/generation/ResultImage";
import { DOUBLE_CLICK_HINT } from "@/lib/jobs/text";
import { parseInfo, pickedSeeds } from "@/lib/request/restoreParams";

interface ResultThumbPreviewProps {
  result: GenerationResult;
  imageIndex: number;
  anchorRect: DOMRect | null;
}

/** What the preview says about the image: the seed is the picked image's. */
function infoMeta(result: GenerationResult, imageIndex: number): Record<string, string> {
  const info = parseInfo(result.info);
  if (!info) return {};
  const meta: Record<string, string> = {};
  const { seed } = pickedSeeds(result.parameters, info, imageIndex);
  const { steps, sampler_name: sampler, width: w, height: h } = info;
  if (seed >= 0) meta["Seed"] = String(seed);
  if (typeof steps === "number" || typeof steps === "string") meta["Steps"] = String(steps);
  if (typeof sampler === "string") meta["Sampler"] = sampler;
  if (typeof w === "number" && typeof h === "number") meta["Size"] = `${w}x${h}`;
  return meta;
}

export function ResultThumbPreview({ result, imageIndex, anchorRect }: ResultThumbPreviewProps) {
  const meta = useMemo(() => infoMeta(result, imageIndex), [result, imageIndex]);
  const entries = Object.entries(meta);

  if (!anchorRect) return null;

  const style: React.CSSProperties = {
    position: "fixed",
    left: anchorRect.left + anchorRect.width / 2,
    top: anchorRect.top - 8,
    transform: "translate(-50%, -100%)",
    zIndex: 60,
    pointerEvents: "none",
  };

  return createPortal(
    <div style={style} className="flex flex-col items-center">
      <div className="rounded-lg overflow-hidden border border-border bg-popover shadow-xl">
        <ResultImage
          image={result.images[imageIndex]}
          alt="Preview"
          className="w-64 max-h-64 object-contain bg-black"
        />

        {entries.length > 0 && (
          <div className="px-2 py-1 flex flex-wrap gap-x-3 gap-y-0.5 text-3xs text-muted-foreground">
            {entries.map(([k, v]) => (
              <span key={k}>
                <span className="text-foreground/60">{k}:</span> {v}
              </span>
            ))}
          </div>
        )}
        <div className="border-t border-border/50 px-2 py-1 text-3xs text-muted-foreground">
          {DOUBLE_CLICK_HINT}
        </div>
      </div>
    </div>,
    document.body,
  );
}
