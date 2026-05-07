import { useCallback, useState } from "react";
import { useImageZoomPan } from "@/hooks/useImageZoomPan";
import { useShortcut } from "@/hooks/useShortcut";
import type { ComparisonImage } from "@/stores/comparisonStore";

interface OverlayModeProps {
  imageA: ComparisonImage;
  imageB: ComparisonImage;
}

export function OverlayMode({ imageA, imageB }: OverlayModeProps) {
  const zoom = useImageZoomPan();
  const [showB, setShowB] = useState(false);

  const toggle = useCallback(() => setShowB((v) => !v), []);

  // Space toggles A/B regardless of which element has focus, via the comparison scope
  useShortcut("comparison-toggle", toggle);

  const current = showB ? imageB : imageA;

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- role="application" surfaces own gesture handlers per WAI-ARIA 1.2
    <div
      role="application"
      aria-label="Comparison overlay; click or Space to toggle A/B"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- role="application" takes keyboard ownership per WAI-ARIA 1.2
      tabIndex={0}
      className="relative h-full w-full overflow-hidden flex items-center justify-center select-none outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
      onWheel={zoom.handlers.onWheel}
      onMouseDown={zoom.handlers.onMouseDown}
      onMouseMove={zoom.handlers.onMouseMove}
      onMouseUp={zoom.handlers.onMouseUp}
      onMouseLeave={zoom.handlers.onMouseLeave}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      }}
      style={{ cursor: zoom.scale > 1 ? zoom.style.cursor : "pointer" }}
    >
      {/* Image A */}
      <img
        src={imageA.src}
        alt={imageA.label}
        className="absolute max-w-full max-h-full object-contain transition-opacity duration-150"
        style={{ transform: zoom.style.transform, opacity: showB ? 0 : 1 }}
        draggable={false}
      />

      {/* Image B */}
      <img
        src={imageB.src}
        alt={imageB.label}
        className="absolute max-w-full max-h-full object-contain transition-opacity duration-150"
        style={{ transform: zoom.style.transform, opacity: showB ? 1 : 0 }}
        draggable={false}
      />

      {/* Label badge */}
      <span className="absolute top-2 left-2 bg-black/60 text-white text-2xs px-2 py-0.5 rounded z-10">
        {current.label} {showB ? "(B)" : "(A)"}
      </span>
      <span className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/60 text-white text-3xs px-2 py-0.5 rounded z-10">
        Click or press Space to toggle
      </span>
    </div>
  );
}
