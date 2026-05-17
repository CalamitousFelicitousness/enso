import { useEffect, useRef } from "react";
import { Layer, Image as KonvaImage } from "react-konva";
import { useCanvasStore } from "@/stores/canvasStore";
import type { ReferenceFramePosition } from "@/canvas/useControlFrameLayout";

/**
 * Konva-side image rendering for the Reference filmstrip. One KonvaImage per
 * slot, sized to fill its assigned ReferenceFramePosition. The DOM-overlay
 * ReferenceSlot component (filmstrip container) sits on top of these and owns
 * the chrome (header, brackets, drop-replace overlay, drag handles).
 *
 * Position and size come from the layout hook in display units; this layer
 * renders directly at the Stage's top level (no displayScale Group wrapper),
 * matching OutputLayer's convention.
 *
 * HTMLImageElement cache mirrors CompositeLayer's pattern: a ref-held Map
 * keyed by ref.id, synced in an effect so newly-added refs preload their
 * pixel data without re-creating Image instances on every render.
 */
interface ReferenceImageLayerProps {
  frames: ReferenceFramePosition[];
}

export function ReferenceImageLayer({ frames }: ReferenceImageLayerProps) {
  const referenceInputs = useCanvasStore((s) => s.referenceInputs);
  const imageMap = useRef<Map<string, HTMLImageElement>>(new Map());

  // Sync the HTMLImageElement cache with the current referenceInputs list.
  // Preloads images for newly-added refs; drops cached entries for removed
  // ones so the cache doesn't leak across long sessions.
  useEffect(() => {
    const current = new Set<string>();
    for (const ref of referenceInputs) {
      current.add(ref.id);
      if (!imageMap.current.has(ref.id)) {
        const img = new window.Image();
        img.src = ref.imageData;
        imageMap.current.set(ref.id, img);
      }
    }
    for (const id of imageMap.current.keys()) {
      if (!current.has(id)) imageMap.current.delete(id);
    }
  }, [referenceInputs]);

  return (
    <Layer listening={false}>
      {/* eslint-disable-next-line react-hooks/refs -- imageMap is synced against referenceInputs in the effect above */}
      {frames.map((frame) => (
        <KonvaImage
          key={frame.refId}
          image={imageMap.current.get(frame.refId)}
          x={frame.x}
          y={frame.y}
          width={frame.displayW}
          height={frame.displayH}
          listening={false}
        />
      ))}
    </Layer>
  );
}
