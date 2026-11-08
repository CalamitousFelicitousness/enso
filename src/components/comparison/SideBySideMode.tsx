import { useImageZoomPan, usePictureZoomKeys } from "@/hooks/useImageZoomPan";
import type { ComparisonImage } from "@/stores/comparisonStore";

interface SideBySideModeProps {
  imageA: ComparisonImage;
  imageB: ComparisonImage;
}

export function SideBySideMode({ imageA, imageB }: SideBySideModeProps) {
  // One view for both panes, so they zoom and pan together
  const zoom = useImageZoomPan();
  const { bind } = zoom;
  usePictureZoomKeys("comparison", zoom);

  return (
    <div className="flex h-full w-full gap-1">
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- role="application" surfaces own gesture handlers per WAI-ARIA 1.2 */}
      <div
        ref={bind}
        role="application"
        aria-label={`Comparison side-by-side, left image: ${imageA.label}`}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- role="application" takes keyboard ownership per WAI-ARIA 1.2
        tabIndex={0}
        className="flex-1 overflow-hidden flex items-center justify-center relative outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
        onMouseDown={zoom.handlers.onMouseDown}
        onMouseMove={zoom.handlers.onMouseMove}
        onMouseUp={zoom.handlers.onMouseUp}
        onMouseLeave={zoom.handlers.onMouseLeave}
        style={{ cursor: zoom.style.cursor }}
      >
        <img
          src={imageA.src}
          alt={imageA.label}
          className="max-w-full max-h-full object-contain"
          style={{ transform: zoom.style.transform }}
          draggable={false}
        />

        <span className="absolute top-2 left-2 bg-black/60 text-white text-2xs px-2 py-0.5 rounded">
          {imageA.label}
        </span>
      </div>
      <div className="w-px bg-white/20 flex-shrink-0" />
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- role="application" surfaces own gesture handlers per WAI-ARIA 1.2 */}
      <div
        ref={bind}
        role="application"
        aria-label={`Comparison side-by-side, right image: ${imageB.label}`}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- role="application" takes keyboard ownership per WAI-ARIA 1.2
        tabIndex={0}
        className="flex-1 overflow-hidden flex items-center justify-center relative outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
        onMouseDown={zoom.handlers.onMouseDown}
        onMouseMove={zoom.handlers.onMouseMove}
        onMouseUp={zoom.handlers.onMouseUp}
        onMouseLeave={zoom.handlers.onMouseLeave}
        style={{ cursor: zoom.style.cursor }}
      >
        <img
          src={imageB.src}
          alt={imageB.label}
          className="max-w-full max-h-full object-contain"
          style={{ transform: zoom.style.transform }}
          draggable={false}
        />

        <span className="absolute top-2 left-2 bg-black/60 text-white text-2xs px-2 py-0.5 rounded">
          {imageB.label}
        </span>
      </div>
    </div>
  );
}
