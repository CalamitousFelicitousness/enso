import { useState, useRef, useCallback } from "react";

const FRAME_AR = 3 / 4; // 0.75
const MISMATCH_THRESHOLD = 1.4; // ~30% area loss triggers contain mode

type FitMode = "loading" | "cover" | "contain";

interface SmartCardImageProps {
  src: string;
  alt: string;
  imgClassName?: string;
  threshold?: number;
}

export function SmartCardImage({
  src,
  alt,
  imgClassName = "",
  threshold = MISMATCH_THRESHOLD,
}: SmartCardImageProps) {
  const [fitMode, setFitMode] = useState<FitMode>("loading");
  const imgRef = useRef<HTMLImageElement>(null);

  const handleLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const imageAR = img.naturalWidth / img.naturalHeight;
    const ratio = Math.max(imageAR, FRAME_AR) / Math.min(imageAR, FRAME_AR);
    setFitMode(ratio > threshold ? "contain" : "cover");
  }, [threshold]);

  if (fitMode === "contain") {
    return (
      <>
        {/* Blurred backdrop */}
        <img
          src={src}
          alt=""
          aria-hidden
          className="absolute inset-0 size-full object-cover scale-120 blur-[20px] opacity-60"
        />
        <div className="absolute inset-0 bg-black/25" />
        {/* Contained image */}
        <img
          src={src}
          alt={alt}
          className={`relative size-full object-contain drop-shadow-lg ${imgClassName}`}
        />
      </>
    );
  }

  return (
    <img
      ref={imgRef}
      src={src}
      alt={alt}
      onLoad={handleLoad}
      className={`size-full object-cover ${imgClassName} ${
        fitMode === "loading" ? "opacity-0" : "opacity-100"
      } transition-opacity duration-200`}
    />
  );
}
