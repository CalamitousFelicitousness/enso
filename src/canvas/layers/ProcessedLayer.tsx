// The processed composite beside the output: the picture the last job's
// control processing produced, else the Control frames' own processed maps
// added together, so the user sees what the control models were fed.

import { useEffect, useRef, useState } from "react";
import { Layer, Rect, Image as KonvaImage } from "react-konva";
import { CornerBrackets } from "@/canvas/layers/CornerBrackets";
import { PROCESSED_COLOR } from "@/canvas/frameColors";
import { useCanvasStore } from "@/stores/canvasStore";
import { useInputStore } from "@/stores/inputStore";
import { useShallow } from "zustand/react/shallow";

interface ProcessedLayerProps {
  offsetX: number;
  width: number;
  height: number;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve(img.naturalWidth > 0 ? img : null);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export function ProcessedLayer({ offsetX, width, height }: ProcessedLayerProps) {
  const processedUrl = useCanvasStore((s) => s.processedUrl);
  const maps = useInputStore(
    useShallow((s) =>
      s.frames.flatMap((f) =>
        f.role === "control" && f.enabled && f.processed?.blob ? [f.processed.blob] : [],
      ),
    ),
  );
  const [displayImage, setDisplayImage] = useState<HTMLImageElement | HTMLCanvasElement | null>(
    null,
  );
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    const live = () => generation.current === mine;
    const load = async () => {
      if (processedUrl) {
        const img = await loadImage(processedUrl);
        if (live()) setDisplayImage(img);
        return;
      }
      const urls = maps.map((blob) => URL.createObjectURL(blob));
      try {
        const images = (await Promise.all(urls.map(loadImage))).filter((i) => i !== null);
        if (!live()) return;
        if (images.length === 0) {
          setDisplayImage(null);
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.globalCompositeOperation = "lighter";
        for (const img of images) ctx.drawImage(img, 0, 0, width, height);
        setDisplayImage(canvas);
      } finally {
        for (const url of urls) URL.revokeObjectURL(url);
      }
    };
    void load();
  }, [processedUrl, maps, width, height]);

  return (
    <Layer>
      {displayImage && (
        <KonvaImage
          image={displayImage}
          x={offsetX}
          y={0}
          width={width}
          height={height}
          listening={false}
        />
      )}
      <Rect
        x={offsetX}
        y={0}
        width={width}
        height={height}
        stroke={PROCESSED_COLOR}
        strokeWidth={1}
        {...(!displayImage && { dash: [8, 4] })}
        listening={false}
      />
      {displayImage && (
        <CornerBrackets x={offsetX} y={0} w={width} h={height} color={PROCESSED_COLOR} />
      )}
    </Layer>
  );
}
