// Legacy mask-objects render. The Transformer + image-layer rendering
// retired (absorbed into InputFrameLayer). This layer
// keeps the global canvasStore.layers mask object render alive until
// deletes the file outright; legacy bakedMask state still flows
// through canvasStore.layers between and.

import { useEffect, useRef } from "react";
import { Layer, Group, Image as KonvaImage } from "react-konva";
import { useCanvasStore, type MaskObjectLayer } from "@/stores/canvasStore";

interface CompositeLayerProps {
  displayScale: number;
}

export function CompositeLayer({ displayScale }: CompositeLayerProps) {
  const layers = useCanvasStore((s) => s.layers);
  const maskVisible = useCanvasStore((s) => s.maskVisible);
  const maskColor = useCanvasStore((s) => s.maskColor);
  const maskAlpha = maskColor.length > 7 ? parseInt(maskColor.slice(7, 9), 16) / 255 : 1;

  const maskLayers = layers.filter((l): l is MaskObjectLayer => l.type === "mask");

  const imageMap = useRef<Map<string, HTMLImageElement>>(new Map());

  useEffect(() => {
    const current = new Set<string>();
    for (const layer of maskLayers) {
      current.add(layer.id);
      const existing = imageMap.current.get(layer.id);
      if (!existing || existing.src !== layer.imageData) {
        const img = new window.Image();
        img.src = layer.imageData;
        imageMap.current.set(layer.id, img);
      }
    }
    for (const id of imageMap.current.keys()) {
      if (!current.has(id)) imageMap.current.delete(id);
    }
  }, [maskLayers]);

  return (
    <Layer>
      <Group scaleX={displayScale} scaleY={displayScale}>
        {/* eslint-disable react-hooks/refs -- imageMap synced with maskLayers in effect above */}
        {maskVisible &&
          maskLayers.map((layer) => (
            <KonvaImage
              key={layer.id}
              image={imageMap.current.get(layer.id)}
              x={layer.x}
              y={layer.y}
              scaleX={layer.scaleX}
              scaleY={layer.scaleY}
              rotation={layer.rotation}
              opacity={layer.visible ? maskAlpha : 0}
              visible={layer.visible}
              listening={false}
            />
          ))}
        {/* eslint-enable react-hooks/refs */}
      </Group>
    </Layer>
  );
}
