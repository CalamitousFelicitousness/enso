import { useCallback, useRef, useState } from "react";
import { useImageZoomPan } from "@/hooks/useImageZoomPan";
import type { ComparisonImage } from "@/stores/comparisonStore";

interface SwipeModeProps {
  imageA: ComparisonImage;
  imageB: ComparisonImage;
}

export function SwipeMode({ imageA, imageB }: SwipeModeProps) {
  const zoom = useImageZoomPan();
  const [dividerPct, setDividerPct] = useState(50);
  const draggingDivider = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDividerDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingDivider.current = true;

    const onMove = (ev: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setDividerPct(Math.max(0, Math.min(100, pct)));
    };
    const onUp = () => {
      draggingDivider.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- role="application" surfaces own gesture handlers per WAI-ARIA 1.2
    <div
      ref={containerRef}
      role="application"
      aria-label="Comparison swipe view; arrow keys move divider"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- role="application" takes keyboard ownership per WAI-ARIA 1.2
      tabIndex={0}
      className="relative h-full w-full overflow-hidden select-none outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
      onWheel={zoom.handlers.onWheel}
      onMouseDown={zoom.handlers.onMouseDown}
      onMouseMove={zoom.handlers.onMouseMove}
      onMouseUp={zoom.handlers.onMouseUp}
      onMouseLeave={zoom.handlers.onMouseLeave}
      style={{ cursor: zoom.style.cursor }}
    >
      {/* Image B (full, behind) */}
      <div className="absolute inset-0 flex items-center justify-center">
        <img
          src={imageB.src}
          alt={imageB.label}
          className="max-w-full max-h-full object-contain"
          style={{ transform: zoom.style.transform }}
          draggable={false}
        />
      </div>

      {/* Image A (clipped from left) */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ clipPath: `inset(0 ${100 - dividerPct}% 0 0)` }}
      >
        <img
          src={imageA.src}
          alt={imageA.label}
          className="max-w-full max-h-full object-contain"
          style={{ transform: zoom.style.transform }}
          draggable={false}
        />
      </div>

      {/* Divider */}
      <div
        role="slider"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(dividerPct)}
        aria-label="Comparison divider position, percent"
        tabIndex={0}
        className="absolute top-0 bottom-0 w-1 bg-white/80 cursor-col-resize z-10 hover:bg-white outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
        style={{ left: `${dividerPct}%`, transform: "translateX(-50%)" }}
        onMouseDown={handleDividerDown}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 10 : 1;
          switch (e.key) {
            case "ArrowLeft":
            case "ArrowDown":
              e.preventDefault();
              setDividerPct((v) => Math.max(0, v - step));
              break;
            case "ArrowRight":
            case "ArrowUp":
              e.preventDefault();
              setDividerPct((v) => Math.min(100, v + step));
              break;
            case "Home":
              e.preventDefault();
              setDividerPct(0);
              break;
            case "End":
              e.preventDefault();
              setDividerPct(100);
              break;
            case "PageDown":
              e.preventDefault();
              setDividerPct((v) => Math.max(0, v - 10));
              break;
            case "PageUp":
              e.preventDefault();
              setDividerPct((v) => Math.min(100, v + 10));
              break;
          }
        }}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-8 bg-white/90 rounded flex items-center justify-center">
          <span className="text-black text-3xs font-bold select-none">⟺</span>
        </div>
      </div>

      {/* Labels */}
      <span className="absolute top-2 left-2 bg-black/60 text-white text-2xs px-2 py-0.5 rounded z-10">
        {imageA.label}
      </span>
      <span className="absolute top-2 right-2 bg-black/60 text-white text-2xs px-2 py-0.5 rounded z-10">
        {imageB.label}
      </span>
    </div>
  );
}
