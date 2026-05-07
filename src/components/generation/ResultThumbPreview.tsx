import { useMemo } from "react";
import { createPortal } from "react-dom";
import type { GenerationResult } from "@/stores/generationStore";
import { resolveImageSrc } from "@/lib/utils";

interface ResultThumbPreviewProps {
  result: GenerationResult;
  imageIndex: number;
  anchorRect: DOMRect | null;
}

function parseInfoMeta(info: string): Record<string, string> {
  try {
    const parsed = JSON.parse(info) as Record<string, unknown>;
    const meta: Record<string, string> = {};
    const seed = parsed["seed"];
    const steps = parsed["steps"];
    const sampler = parsed["sampler_name"];
    const w = parsed["width"];
    const h = parsed["height"];
    if (typeof seed === "number" || typeof seed === "string") meta["Seed"] = String(seed);
    if (typeof steps === "number" || typeof steps === "string") meta["Steps"] = String(steps);
    if (typeof sampler === "string") meta["Sampler"] = sampler;
    if (typeof w === "number" && typeof h === "number") meta["Size"] = `${w}x${h}`;
    return meta;
  } catch {
    return {};
  }
}

export function ResultThumbPreview({
  result,
  imageIndex,
  anchorRect,
}: ResultThumbPreviewProps) {
  const src = resolveImageSrc(result.images[imageIndex]);
  const meta = useMemo(() => parseInfoMeta(result.info), [result.info]);
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
        <img
          src={src}
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
      </div>
    </div>,
    document.body,
  );
}
