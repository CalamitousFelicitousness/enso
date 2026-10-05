// Every mask visual on its own Konva Layer: baked mask objects, committed
// strokes waiting for the bake, and the stroke being drawn. Everything here
// draws at full alpha in the mask colour and the layer's canvas element
// carries the mask alpha as CSS opacity, so overlaps composite flat and an
// eraser's destination-out only ever cuts mask pixels, never the image
// underneath. The moment a bake lands, its bitmaps replace the pending
// lines with the same pixels.

import { memo, useCallback, useEffect, useState } from "react";
import { Group, Image as KonvaImage, Layer, Line } from "react-konva";
import { useCanvasStore } from "@/stores/canvasStore";
import { useInputStore } from "@/stores/inputStore";
import type { MaskContent, MaskObject } from "@/lib/inputs/types";
import { ensureMaskBitmap, maskBitmap } from "@/lib/mask/bitmaps";
import { requestMaskBake } from "@/lib/mask/baker";
import {
  useLayerInteraction,
  type LayerInteraction,
  type Snap,
} from "@/canvas/tools/useLayerInteraction";
import type { InitialFramePosition, InputFramePosition } from "@/canvas/inputFrameTypes";
import type Konva from "konva";

type SetNodeRef = (frameId: string, layerId: string, node: Konva.Image | null) => void;

interface MaskLayerProps {
  frames: InputFramePosition[];
  displayScale: number;
  setNodeRef: SetNodeRef;
  snap: Snap;
  /** useMaskPaint's callback for the active stroke node, attached inside the
   * selected frame's displayScale group so coordinates are frame pixels. */
  setActiveLineNode?: ((node: Konva.Line | null) => void) | undefined;
}

export function MaskLayer({
  frames,
  displayScale,
  setNodeRef,
  snap,
  setActiveLineNode,
}: MaskLayerProps) {
  const selectedFrameId = useInputStore((s) => s.selectedFrameId);
  const draggable = useCanvasStore((s) => s.activeTool === "move");
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

  if (frames.length === 0) return null;

  return (
    <Layer ref={layerRef} visible={maskVisible}>
      {frames.map((frame) =>
        frame.kind === "initial" ? (
          <MaskFrame
            key={frame.frameId}
            frame={frame}
            displayScale={displayScale}
            isSelected={selectedFrameId === frame.frameId}
            draggable={draggable}
            maskColorRgb={maskColorRgb}
            setNodeRef={setNodeRef}
            interaction={interaction}
            setActiveLineNode={setActiveLineNode}
          />
        ) : null,
      )}
    </Layer>
  );
}

const NO_MASK: MaskContent = { objects: [], strokes: [] };

interface MaskFrameProps {
  frame: InitialFramePosition;
  displayScale: number;
  isSelected: boolean;
  draggable: boolean;
  maskColorRgb: string;
  setNodeRef: SetNodeRef;
  interaction: LayerInteraction;
  setActiveLineNode?: ((node: Konva.Line | null) => void) | undefined;
}

const MaskFrame = memo(function MaskFrame({
  frame,
  displayScale,
  isSelected,
  draggable,
  maskColorRgb,
  setNodeRef,
  interaction,
  setActiveLineNode,
}: MaskFrameProps) {
  const mask = useInputStore((s) => s.frames.find((f) => f.id === frame.frameId)?.mask) ?? NO_MASK;

  // Pending strokes get baked; masks restored from storage get decoded.
  const [, setDecoded] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (mask.strokes.length > 0) requestMaskBake(frame.frameId);
    for (const object of mask.objects) {
      if (!object.visible || maskBitmap(object)) continue;
      void ensureMaskBitmap(object.blob).then(() => {
        if (!cancelled) setDecoded((n) => n + 1);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [mask, frame.frameId]);

  const clipToFrame = (ctx: Konva.Context) => {
    ctx.rect(0, 0, frame.frameW, frame.frameH);
  };

  return (
    <Group x={frame.x} y={frame.y} scaleX={displayScale} scaleY={displayScale}>
      {mask.objects.map((object) =>
        object.visible ? (
          <MaskNode
            key={object.id}
            frameId={frame.frameId}
            object={object}
            draggable={draggable && !object.locked}
            setNodeRef={setNodeRef}
            interaction={interaction}
          />
        ) : null,
      )}
      {mask.strokes.length > 0 && (
        <Group clipFunc={clipToFrame} listening={false}>
          {mask.strokes.map((line, i) => (
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
      {isSelected && setActiveLineNode && (
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
});

interface MaskNodeProps {
  frameId: string;
  object: MaskObject;
  draggable: boolean;
  setNodeRef: SetNodeRef;
  interaction: LayerInteraction;
}

function MaskNode({ frameId, object, draggable, setNodeRef, interaction }: MaskNodeProps) {
  const nodeRef = useCallback(
    (node: Konva.Image | null) => setNodeRef(frameId, object.id, node),
    [frameId, object.id, setNodeRef],
  );
  const image = maskBitmap(object);
  if (!image) return null;
  const { transform } = object;
  return (
    <KonvaImage
      ref={nodeRef}
      image={image}
      x={transform.x}
      y={transform.y}
      width={object.width}
      height={object.height}
      scaleX={transform.scaleX}
      scaleY={transform.scaleY}
      rotation={transform.rotation}
      listening={!object.locked}
      draggable={draggable}
      onDragMove={interaction.onLayerDragMove}
      onDragEnd={(e) => interaction.onLayerDragEnd(frameId, object.id, e)}
      onTransformEnd={(e) => interaction.onLayerTransformEnd(frameId, object.id, e)}
      onClick={(e) => interaction.onLayerClick(frameId, object.id, e)}
    />
  );
}
