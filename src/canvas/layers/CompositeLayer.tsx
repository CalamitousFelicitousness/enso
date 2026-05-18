// WYSIWYG display rendering - Konva scene graph side.
//
// This renders image layers on screen using Konva's GPU-accelerated scene graph.
// The layer transforms here (x, y, scaleX, scaleY, rotation) must match the
// Canvas 2D transforms in flattenCanvas.ts. Both codepaths independently produce
// the same visual result. Changes to transform logic must update both.

import { useEffect, useRef, useCallback } from "react";
import { Layer, Group, Image as KonvaImage, Transformer, Line } from "react-konva";
import {
  useCanvasStore,
  type ImageLayer as ImageLayerType,
  type MaskObjectLayer,
} from "@/stores/canvasStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useSnap } from "@/canvas/tools/useSnap";
import type Konva from "konva";

interface CompositeLayerProps {
  trRef: React.RefObject<Konva.Transformer | null>;
  displayScale: number;
}

export function CompositeLayer({ trRef, displayScale }: CompositeLayerProps) {
  const layers = useCanvasStore((s) => s.layers);
  const activeLayerId = useCanvasStore((s) => s.activeLayerId);
  const activeTool = useCanvasStore((s) => s.activeTool);
  const updateLayer = useCanvasStore((s) => s.updateLayer);
  const setActiveLayer = useCanvasStore((s) => s.setActiveLayer);
  const inputRole = useCanvasStore((s) => s.inputRole);
  const frameW = useGenerationStore((s) => s.width);
  const frameH = useGenerationStore((s) => s.height);
  const snap = useSnap(frameW, frameH, trRef, 0, 0, displayScale);

  // In Reference mode the source file is sent at native resolution and canvas
  // transforms (position, scale, rotation) are not applied to the request.
  // Render image layers at identity so the visual representation matches what
  // ships on the wire. Persisted transforms stay in the store and are
  // restored when the toggle flips back to Initial.
  const isReferenceMode = inputRole === "reference";

  const maskVisible = useCanvasStore((s) => s.maskVisible);
  const maskColor = useCanvasStore((s) => s.maskColor);
  const maskAlpha = maskColor.length > 7 ? parseInt(maskColor.slice(7, 9), 16) / 255 : 1;

  const imageMap = useRef<Map<string, HTMLImageElement>>(new Map());
  const nodeMap = useRef<Map<string, Konva.Image>>(new Map());

  // Phase 13: image layers are rendered by InputFrameLayer now (reads
  // from inputFrames). CompositeLayer keeps the imageLayers slice for
  // Transformer attachment + the mask layers slice for the on-canvas
  // mask paint surface, but the imageLayers themselves are no longer
  // drawn here - InputFrameLayer would double-render them otherwise.
  const imageLayers = layers.filter((l) => l.type === "image") as ImageLayerType[];
  const maskLayers = layers.filter((l) => l.type === "mask") as MaskObjectLayer[];
  const RENDER_LEGACY_IMAGE_LAYERS = false;

  // Load/unload HTMLImageElements as layers change (images + masks)
  useEffect(() => {
    const current = new Set<string>();
    for (const layer of imageLayers) {
      current.add(layer.id);
      if (!imageMap.current.has(layer.id)) {
        const img = new window.Image();
        img.src = layer.imageData;
        imageMap.current.set(layer.id, img);
      }
    }
    for (const layer of maskLayers) {
      current.add(layer.id);
      const existing = imageMap.current.get(layer.id);
      if (!existing || existing.src !== layer.imageData) {
        const img = new window.Image();
        img.src = layer.imageData;
        imageMap.current.set(layer.id, img);
      }
    }
    // Clean up removed layers
    for (const id of imageMap.current.keys()) {
      if (!current.has(id)) {
        imageMap.current.delete(id);
        nodeMap.current.delete(id);
      }
    }
  }, [imageLayers, maskLayers]);

  // Attach transformer to active layer node (image or unlocked mask)
  useEffect(() => {
    if (!trRef.current) return;
    // Reference mode locks all image transforms; suppress the Transformer
    // attachment so the move tool can't grab the active image's handles.
    if (activeLayerId && activeTool === "move" && !isReferenceMode) {
      const activeLayer = layers.find((l) => l.id === activeLayerId);
      // Only attach transformer to unlocked layers
      if (activeLayer && !activeLayer.locked) {
        const node = nodeMap.current.get(activeLayerId);
        if (node) {
          trRef.current.nodes([node]);
          trRef.current.getLayer()?.batchDraw();
          return;
        }
      }
    }
    trRef.current.nodes([]);
    trRef.current.getLayer()?.batchDraw();
  }, [activeLayerId, activeTool, trRef, layers, isReferenceMode]);

  const handleDragEnd = useCallback(
    (layerId: string, e: Konva.KonvaEventObject<DragEvent>) => {
      snap.clearGuides();
      updateLayer(layerId, {
        x: e.target.x(),
        y: e.target.y(),
      } as Partial<ImageLayerType>);
    },
    [updateLayer, snap],
  );

  const handleTransformEnd = useCallback(
    (layerId: string, e: Konva.KonvaEventObject<Event>) => {
      snap.clearGuides();
      const node = e.target as Konva.Image;
      updateLayer(layerId, {
        x: node.x(),
        y: node.y(),
        scaleX: node.scaleX(),
        scaleY: node.scaleY(),
        rotation: node.rotation(),
      } as Partial<ImageLayerType>);
    },
    [updateLayer, snap],
  );

  const handleClick = useCallback(
    (layerId: string, e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.evt.button !== 0 || activeTool !== "move") return;
      e.cancelBubble = true;
      setActiveLayer(layerId);
    },
    [activeTool, setActiveLayer],
  );

  const setNodeRef = useCallback((layerId: string, node: Konva.Image | null) => {
    if (node) {
      nodeMap.current.set(layerId, node);
    } else {
      nodeMap.current.delete(layerId);
    }
  }, []);

  return (
    <Layer>
      <Group scaleX={displayScale} scaleY={displayScale}>
        {/* eslint-disable react-hooks/refs -- imageMap synced with imageLayers in effect above */}
        {RENDER_LEGACY_IMAGE_LAYERS &&
          imageLayers.map((layer) => {
            // Reference autoscale: each image is fit to the input frame's pixel
            // height (= frameH after useControlFrameLayout's normalization), so
            // every layer shows at the same visual height regardless of native
            // pixel dims. Width follows the layer's aspect. Persisted transforms
            // in the store stay untouched; only the rendered transforms differ.
            const refScale =
              isReferenceMode && layer.naturalHeight > 0 ? frameH / layer.naturalHeight : 1;
            return (
              <KonvaImage
                key={layer.id}
                ref={(node) => setNodeRef(layer.id, node)}
                image={imageMap.current.get(layer.id)}
                x={isReferenceMode ? 0 : layer.x}
                y={isReferenceMode ? 0 : layer.y}
                scaleX={isReferenceMode ? refScale : layer.scaleX}
                scaleY={isReferenceMode ? refScale : layer.scaleY}
                rotation={isReferenceMode ? 0 : layer.rotation}
                opacity={layer.opacity}
                visible={layer.visible}
                draggable={activeTool === "move" && !layer.locked && !isReferenceMode}
                onDragMove={snap.handleDragMove}
                onDragEnd={(e) => handleDragEnd(layer.id, e)}
                onTransformEnd={(e) => handleTransformEnd(layer.id, e)}
                onClick={(e) => handleClick(layer.id, e)}
              />
            );
          })}
        {/* eslint-enable react-hooks/refs */}
        {/* eslint-disable react-hooks/refs -- imageMap synced with maskLayers in effect above */}
        {maskVisible &&
          maskLayers.map((layer) => (
            <KonvaImage
              key={layer.id}
              ref={(node) => setNodeRef(layer.id, node)}
              image={imageMap.current.get(layer.id)}
              x={layer.x}
              y={layer.y}
              scaleX={layer.scaleX}
              scaleY={layer.scaleY}
              rotation={layer.rotation}
              opacity={layer.visible ? maskAlpha : 0}
              visible={layer.visible}
              listening={!layer.locked}
              draggable={activeTool === "move" && !layer.locked}
              onDragMove={snap.handleDragMove}
              onDragEnd={(e) => handleDragEnd(layer.id, e)}
              onTransformEnd={(e) => handleTransformEnd(layer.id, e)}
              onClick={(e) => handleClick(layer.id, e)}
            />
          ))}
        {/* eslint-enable react-hooks/refs */}
        <Transformer
          ref={trRef}
          keepRatio={false}
          enabledAnchors={[
            "top-left",
            "top-right",
            "bottom-left",
            "bottom-right",
            "top-center",
            "bottom-center",
            "middle-left",
            "middle-right",
          ]}
          onTransform={snap.handleTransform}
        />

        {snap.guides.map((g, i) => (
          <Line
            key={i}
            points={
              g.orientation === "v" ? [g.pos, -5000, g.pos, 5000] : [-5000, g.pos, 5000, g.pos]
            }
            stroke="#22d3ee"
            strokeWidth={1}
            strokeScaleEnabled={false}
            listening={false}
          />
        ))}
      </Group>
    </Layer>
  );
}
