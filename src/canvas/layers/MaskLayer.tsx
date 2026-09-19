// Every mask visual on its own Konva Layer: baked mask objects, committed
// strokes waiting for the bake, and the stroke being drawn. Everything here
// draws at full alpha in the mask colour and the layer's canvas element
// carries the mask alpha as CSS opacity, so overlaps composite flat and an
// eraser's destination-out only ever cuts mask pixels, never the image
// underneath. The moment a bake lands, its bitmaps replace the pending
// lines with the same pixels.

import { useCallback, useEffect, useState } from "react";
import { Group, Image as KonvaImage, Layer, Line } from "react-konva";
import { useCanvasStore } from "@/stores/canvasStore";
import type { CanvasLayer, MaskObjectLayer } from "@/stores/canvasStore";
import { ensureMaskBitmap, maskBitmap } from "@/lib/mask/bitmaps";
import { requestMaskBake } from "@/lib/mask/baker";
import { useLayerInteraction, type Snap } from "@/canvas/tools/useLayerInteraction";
import type { InputFrame } from "@/canvas/inputFrames";
import type { InitialFramePosition, InputFramePosition } from "@/canvas/inputFrameTypes";
import type Konva from "konva";

interface MaskLayerProps {
  frames: InputFramePosition[];
  displayScale: number;
  setNodeRef: (frameId: string, layerId: string, node: Konva.Image | null) => void;
  snap: Snap;
  /** useMaskPaint's callback for the active stroke node, attached inside the
   * focused frame's displayScale group so coordinates match frame.maskLines. */
  setActiveLineNode?: ((node: Konva.Line | null) => void) | undefined;
}

const isMask = (l: CanvasLayer): l is MaskObjectLayer => l.type === "mask";

export function MaskLayer({
  frames,
  displayScale,
  setNodeRef,
  snap,
  setActiveLineNode,
}: MaskLayerProps) {
  const storeFrames = useCanvasStore((s) => s.inputFrames);
  const focusedInputFrameId = useCanvasStore((s) => s.activeInputFrameId);
  const activeTool = useCanvasStore((s) => s.activeTool);
  const maskVisible = useCanvasStore((s) => s.maskVisible);
  const maskColor = useCanvasStore((s) => s.maskColor);
  const maskColorRgb = maskColor.slice(0, 7);
  const maskColorAlpha = maskColor.length > 7 ? parseInt(maskColor.slice(7, 9), 16) / 255 : 1;
  const interaction = useLayerInteraction(snap);

  const [layerNode, setLayerNode] = useState<Konva.Layer | null>(null);
  const layerRef = useCallback((node: Konva.Layer | null) => {
    if (node) {
      // Baked masks are minified several times over at 4K; the context
      // resets on every canvas resize, so set the quality before each draw.
      node.on("beforeDraw.maskLayer", () => {
        node.getContext()._context.imageSmoothingQuality = "high";
      });
    }
    setLayerNode(node);
  }, []);

  useEffect(() => {
    if (!layerNode) return;
    layerNode.getNativeCanvasElement().style.opacity = String(maskColorAlpha);
  }, [layerNode, maskColorAlpha]);

  // Pending strokes get baked; masks restored from storage get decoded.
  const [, setDecoded] = useState(0);
  useEffect(() => {
    let cancelled = false;
    for (const frame of storeFrames) {
      if (frame.mode !== "initial") continue;
      if (frame.maskLines.length > 0) requestMaskBake(frame.id);
      for (const layer of frame.layers) {
        if (!isMask(layer) || !layer.visible || maskBitmap(layer)) continue;
        void ensureMaskBitmap(layer.blob).then(() => {
          if (!cancelled) setDecoded((n) => n + 1);
        });
      }
    }
    return () => {
      cancelled = true;
    };
  }, [storeFrames]);

  if (frames.length === 0) return null;

  return (
    <Layer ref={layerRef} visible={maskVisible}>
      {frames.map((frame) => {
        if (frame.kind !== "initial") return null;
        const storeFrame = storeFrames.find((f) => f.id === frame.frameId);
        if (!storeFrame || storeFrame.mode !== "initial") return null;
        return (
          <MaskFrameFragment
            key={frame.frameId}
            frame={frame}
            storeFrame={storeFrame}
            displayScale={displayScale}
            isFocused={focusedInputFrameId === frame.frameId}
            activeTool={activeTool}
            maskColorRgb={maskColorRgb}
            setNodeRef={setNodeRef}
            interaction={interaction}
            setActiveLineNode={setActiveLineNode}
          />
        );
      })}
    </Layer>
  );
}

interface MaskFrameFragmentProps {
  frame: InitialFramePosition;
  storeFrame: InputFrame;
  displayScale: number;
  isFocused: boolean;
  activeTool: string;
  maskColorRgb: string;
  setNodeRef: (frameId: string, layerId: string, node: Konva.Image | null) => void;
  interaction: ReturnType<typeof useLayerInteraction>;
  setActiveLineNode?: ((node: Konva.Line | null) => void) | undefined;
}

function MaskFrameFragment({
  frame,
  storeFrame,
  displayScale,
  isFocused,
  activeTool,
  maskColorRgb,
  setNodeRef,
  interaction,
  setActiveLineNode,
}: MaskFrameFragmentProps) {
  const masks = storeFrame.layers.filter((l): l is MaskObjectLayer => isMask(l) && l.visible);
  const clipToFrame = (ctx: Konva.Context) => {
    ctx.rect(0, 0, frame.frameW, frame.frameH);
  };

  return (
    <Group x={frame.x} y={frame.y} scaleX={displayScale} scaleY={displayScale}>
      {masks.map((mask) => {
        const img = maskBitmap(mask);
        if (!img) return null;
        return (
          <KonvaImage
            key={mask.id}
            ref={(node) => setNodeRef(frame.frameId, mask.id, node)}
            image={img}
            x={mask.x}
            y={mask.y}
            width={mask.width}
            height={mask.height}
            scaleX={mask.scaleX}
            scaleY={mask.scaleY}
            rotation={mask.rotation}
            listening={!mask.locked}
            draggable={activeTool === "move" && !mask.locked}
            onDragMove={interaction.onLayerDragMove}
            onDragEnd={(e) => interaction.onLayerDragEnd(frame.frameId, mask.id, e)}
            onTransformEnd={(e) => interaction.onLayerTransformEnd(frame.frameId, mask.id, e)}
            onClick={(e) => interaction.onLayerClick(frame.frameId, mask.id, e)}
          />
        );
      })}
      {storeFrame.maskLines.length > 0 && (
        <Group clipFunc={clipToFrame} listening={false}>
          {storeFrame.maskLines.map((line, i) => (
            <Line
              key={i}
              points={line.points}
              stroke={maskColorRgb}
              strokeWidth={line.strokeWidth}
              globalCompositeOperation={line.tool === "eraser" ? "destination-out" : "source-over"}
              lineJoin="round"
              lineCap="round"
              listening={false}
            />
          ))}
        </Group>
      )}
      {isFocused && setActiveLineNode && (
        <Group clipFunc={clipToFrame} listening={false}>
          <Line
            ref={setActiveLineNode}
            points={[]}
            stroke={maskColorRgb}
            strokeWidth={20}
            lineJoin="round"
            lineCap="round"
            visible={false}
            listening={false}
          />
        </Group>
      )}
    </Group>
  );
}
