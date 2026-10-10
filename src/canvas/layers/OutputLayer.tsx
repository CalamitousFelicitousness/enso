import { useEffect, useState } from "react";
import { Layer, Image as KonvaImage, Rect } from "react-konva";
import { CornerBrackets } from "@/canvas/layers/CornerBrackets";
import { useGenerationStore } from "@/stores/generationStore";
import { useJobQueueStore, selectViewedJob } from "@/stores/jobStore";
import { loadMediaImage } from "@/api/session";

const BORDER_COLOR = "#60a5fa";

interface OutputLayerProps {
  offsetX: number;
  placeholderWidth: number;
  placeholderHeight: number;
}

export function OutputLayer({ offsetX, placeholderWidth, placeholderHeight }: OutputLayerProps) {
  const viewedJob = useJobQueueStore(selectViewedJob);
  const previewImage = viewedJob?.previewUrl ?? null;
  const results = useGenerationStore((s) => s.results);
  const selectedResultId = useGenerationStore((s) => s.selectedResultId);
  const selectedImageIndex = useGenerationStore((s) => s.selectedImageIndex);
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  // Determine which image to show: live preview during generation, or selected result
  let displaySrc: string | undefined;
  if (previewImage) {
    displaySrc = previewImage;
  } else if (selectedResultId) {
    const selected = results.find((r) => r.id === selectedResultId);
    const raw = selected?.images[selectedImageIndex ?? 0];
    if (raw) {
      displaySrc = raw;
    }
  }

  useEffect(() => {
    if (!displaySrc) return;
    let current = true;
    loadMediaImage(displaySrc)
      .then((img) => {
        if (current) setImage(img);
      })
      .catch((err: unknown) => console.warn("[output] the image could not be loaded", err));
    return () => {
      current = false;
    };
  }, [displaySrc]);

  // Clear stale image when there's nothing to display
  if (!displaySrc && image) setImage(null);

  // Use displaySrc (synchronous) alongside image state so clearing is immediate
  const hasImage = !!displaySrc && !!image;
  const isPreview = !!previewImage;

  // Fit image inside the frame when aspect ratios differ (e.g. detailer preview
  // at 1024x1024 on a 16:9 output frame). Frame never changes shape.
  let imgX = offsetX;
  let imgY = 0;
  let imgW = placeholderWidth;
  let imgH = placeholderHeight;
  if (isPreview && hasImage && image) {
    const natW = image.naturalWidth;
    const natH = image.naturalHeight;
    const frameAR = placeholderWidth / placeholderHeight;
    const imageAR = natW / natH;
    // Only use fit mode when aspect ratios meaningfully differ (>1% tolerance)
    if (Math.abs(frameAR - imageAR) / frameAR > 0.01) {
      if (imageAR > frameAR) {
        imgW = placeholderWidth;
        imgH = placeholderWidth / imageAR;
        imgY = (placeholderHeight - imgH) / 2;
      } else {
        imgH = placeholderHeight;
        imgW = placeholderHeight * imageAR;
        imgX = offsetX + (placeholderWidth - imgW) / 2;
      }
    }
  }

  return (
    <Layer listening={false}>
      {hasImage && (
        <KonvaImage
          image={image}
          x={imgX}
          y={imgY}
          width={imgW}
          height={imgH}
          opacity={isPreview ? 0.85 : 1}
        />
      )}
      <Rect
        x={offsetX}
        y={0}
        width={placeholderWidth}
        height={placeholderHeight}
        stroke={BORDER_COLOR}
        strokeWidth={1}
        listening={false}
      />
      <CornerBrackets
        x={offsetX}
        y={0}
        w={placeholderWidth}
        h={placeholderHeight}
        color={BORDER_COLOR}
      />
    </Layer>
  );
}
