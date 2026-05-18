// New canvas-native chrome for the multi-Input-frame stack. One Konva
// <Layer> rendering display-space top-level (no displayScale Group wrapper
// at the layer root), mirroring ControlFrameLayer's convention. Each frame
// becomes one fragment: Initial frames carry a transform Group with layer
// KonvaImages in pixel-space; Reference frames render as a "mother frame
// with grid of children" per the user's mockup.
//
// this layer now owns the Transformer + image-layer
// interaction (drag, scale, rotate, select). The Transformer attaches to
// whichever node corresponds to the focused frame's activeLayerId.

import { useCallback, useEffect, useRef, useState } from "react";
import { Group, Image as KonvaImage, Layer, Line, Rect, Text, Transformer } from "react-konva";
import {
  INPUT_COLOR_ACTIVE,
  INPUT_COLOR_INACTIVE,
  INPUT_COLOR_REFERENCE,
} from "@/canvas/ControlFramePanel";
import { CornerBrackets } from "@/canvas/layers/ControlFrameLayer";
import { useCanvasStore } from "@/stores/canvasStore";
import type { CanvasLayer, ImageLayer, MaskObjectLayer } from "@/stores/canvasStore";
import { useSnap } from "@/canvas/tools/useSnap";
import type { InputFrame } from "@/canvas/inputFrames";
import type {
  InitialFramePosition,
  InputFramePosition,
  ReferenceFramePosition,
} from "@/canvas/inputFrameTypes";
import type Konva from "konva";

interface InputFrameLayerProps {
  frames: InputFramePosition[];
  displayScale: number;
  /** Transformer ref owned by CanvasStage. The Transformer node itself is
   * rendered here so it can attach to per-frame image/mask nodes within
   * this Layer's draw scope. */
  trRef: React.RefObject<Konva.Transformer | null>;
  /** Called when an empty Initial frame is clicked - opens the file picker
   * targeted at that frame. */
  onPickInputFile?: ((frameId: string) => void) | undefined;
  /** Called when a Reference mother's +Add cell is clicked, or when an
   * empty Reference mother is clicked. */
  onAddReferenceChild?: ((frameId: string) => void) | undefined;
}

export function InputFrameLayer({
  frames,
  displayScale,
  trRef,
  onPickInputFile,
  onAddReferenceChild,
}: InputFrameLayerProps) {
  const storeFrames = useCanvasStore((s) => s.inputFrames);
  const focusedInputFrameId = useCanvasStore((s) => s.activeInputFrameId);
  const setActiveInputFrame = useCanvasStore((s) => s.setActiveInputFrame);
  const setActiveLayerInFrame = useCanvasStore((s) => s.setActiveLayerInFrame);
  const updateLayerInFrame = useCanvasStore((s) => s.updateLayerInFrame);
  const activeTool = useCanvasStore((s) => s.activeTool);

  // Per-image-layer Konva node map, keyed `${frameId}:${layerId}`. The
  // Transformer attaches via this map so its target is unambiguous when
  // multiple Input frames each carry their own active layer.
  const nodeMap = useRef<Map<string, Konva.Image>>(new Map());
  const setNodeRef = useCallback((frameId: string, layerId: string, node: Konva.Image | null) => {
    const key = `${frameId}:${layerId}`;
    if (node) nodeMap.current.set(key, node);
    else nodeMap.current.delete(key);
  }, []);

  const focusedFrame =
    storeFrames.find((f) => f.id === focusedInputFrameId) ?? storeFrames[0] ?? null;
  const focusedFramePosition =
    focusedFrame && focusedFrame.mode === "initial"
      ? (frames.find((f) => f.kind === "initial" && f.frameId === focusedFrame.id) as
          | InitialFramePosition
          | undefined)
      : undefined;
  const focusedActiveLayerId = focusedFrame?.mode === "initial" ? focusedFrame.activeLayerId : null;

  // Snap targets the focused Initial frame's bounds in pixel space. Using
  // (frame.x / ds, frame.y / ds) re-expresses the display-space frame
  // origin in pixel-space so it aligns with the per-image x/y which are
  // already in pixel-space relative to that origin.
  const snap = useSnap(
    focusedFramePosition?.frameW ?? 0,
    focusedFramePosition?.frameH ?? 0,
    trRef,
    focusedFramePosition ? focusedFramePosition.x / displayScale : 0,
    focusedFramePosition ? focusedFramePosition.y / displayScale : 0,
    displayScale,
  );

  // Attach Transformer to the focused frame's active layer when move tool
  // is active. Locked layers and Reference-mode frames suppress attachment.
  useEffect(() => {
    if (!trRef.current) return;
    if (activeTool !== "move" || !focusedFrame || focusedFrame.mode !== "initial") {
      trRef.current.nodes([]);
      trRef.current.getLayer()?.batchDraw();
      return;
    }
    if (!focusedActiveLayerId) {
      trRef.current.nodes([]);
      trRef.current.getLayer()?.batchDraw();
      return;
    }
    const layer = focusedFrame.layers.find((l) => l.id === focusedActiveLayerId);
    if (!layer || layer.locked) {
      trRef.current.nodes([]);
      trRef.current.getLayer()?.batchDraw();
      return;
    }
    const node = nodeMap.current.get(`${focusedFrame.id}:${focusedActiveLayerId}`);
    if (node) {
      trRef.current.nodes([node]);
      trRef.current.getLayer()?.batchDraw();
    } else {
      trRef.current.nodes([]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [activeTool, focusedFrame, focusedActiveLayerId, trRef, storeFrames]);

  // Preload HTMLImageElement for every visible image across every frame.
  const [imageMap, setImageMap] = useState<Map<string, HTMLImageElement>>(new Map());

  useEffect(() => {
    const needed: { id: string; src: string }[] = [];
    for (const frame of storeFrames) {
      if (frame.mode === "initial") {
        for (const layer of frame.layers) {
          if ((layer.type !== "image" && layer.type !== "mask") || !layer.visible) continue;
          const visual = layer as ImageLayer | MaskObjectLayer;
          if (!visual.imageData) continue;
          needed.push({ id: layer.id, src: visual.imageData });
        }
      } else {
        for (const ref of frame.references) {
          if (!ref.imageData) continue;
          needed.push({ id: ref.id, src: ref.imageData });
        }
      }
    }
    const expectedIds = new Set(needed.map((n) => n.id));
    const toRemove: string[] = [];
    for (const key of imageMap.keys()) {
      if (!expectedIds.has(key)) toRemove.push(key);
    }
    const toLoad = needed.filter((n) => !imageMap.has(n.id));
    if (toLoad.length === 0 && toRemove.length === 0) return;
    const aborted = { current: false };
    void (async () => {
      const next = new Map(imageMap);
      for (const id of toRemove) next.delete(id);
      for (const { id, src } of toLoad) {
        if (aborted.current) return;
        const img = new window.Image();
        img.src = src;
        await new Promise<void>((res) => {
          img.onload = () => res();
          img.onerror = () => res();
        });
        if (aborted.current) return;
        next.set(id, img);
      }
      setImageMap(next);
    })();
    return () => {
      aborted.current = true;
    };
  }, [storeFrames, imageMap]);

  const handleInitialClick = useCallback(
    (frameId: string, hasLayers: boolean) => {
      setActiveInputFrame(frameId);
      if (!hasLayers && onPickInputFile) onPickInputFile(frameId);
    },
    [setActiveInputFrame, onPickInputFile],
  );

  const handleReferenceClick = useCallback(
    (frameId: string, hasRefs: boolean) => {
      setActiveInputFrame(frameId);
      if (!hasRefs && onAddReferenceChild) onAddReferenceChild(frameId);
    },
    [setActiveInputFrame, onAddReferenceChild],
  );

  const handleAddCellClick = useCallback(
    (frameId: string) => {
      onAddReferenceChild?.(frameId);
    },
    [onAddReferenceChild],
  );

  const handleLayerClick = useCallback(
    (frameId: string, layerId: string, e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.evt.button !== 0 || activeTool !== "move") return;
      e.cancelBubble = true;
      setActiveInputFrame(frameId);
      setActiveLayerInFrame(frameId, layerId);
    },
    [activeTool, setActiveInputFrame, setActiveLayerInFrame],
  );

  const handleLayerDragEnd = useCallback(
    (frameId: string, layerId: string, e: Konva.KonvaEventObject<DragEvent>) => {
      snap.clearGuides();
      updateLayerInFrame(frameId, layerId, {
        x: e.target.x(),
        y: e.target.y(),
      } as Partial<ImageLayer>);
    },
    [snap, updateLayerInFrame],
  );

  const handleLayerTransformEnd = useCallback(
    (frameId: string, layerId: string, e: Konva.KonvaEventObject<Event>) => {
      snap.clearGuides();
      const node = e.target as Konva.Image;
      updateLayerInFrame(frameId, layerId, {
        x: node.x(),
        y: node.y(),
        scaleX: node.scaleX(),
        scaleY: node.scaleY(),
        rotation: node.rotation(),
      } as Partial<ImageLayer>);
    },
    [snap, updateLayerInFrame],
  );

  if (frames.length === 0) return null;

  return (
    <Layer>
      {frames.map((frame) => {
        const storeFrame = storeFrames.find((f) => f.id === frame.frameId);
        if (!storeFrame) return null;
        const isFocused = focusedInputFrameId === frame.frameId;
        if (frame.kind === "initial") {
          return (
            <InitialFrameFragment
              key={frame.frameId}
              frame={frame}
              storeFrame={storeFrame}
              displayScale={displayScale}
              imageMap={imageMap}
              isFocused={isFocused}
              activeTool={activeTool}
              setNodeRef={setNodeRef}
              snapDragMove={snap.handleDragMove}
              onClick={handleInitialClick}
              onLayerClick={handleLayerClick}
              onLayerDragEnd={handleLayerDragEnd}
              onLayerTransformEnd={handleLayerTransformEnd}
            />
          );
        }
        return (
          <ReferenceFrameFragment
            key={frame.frameId}
            frame={frame}
            storeFrame={storeFrame}
            imageMap={imageMap}
            isFocused={isFocused}
            onClick={handleReferenceClick}
            onAddCellClick={handleAddCellClick}
          />
        );
      })}

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
          points={g.orientation === "v" ? [g.pos, -5000, g.pos, 5000] : [-5000, g.pos, 5000, g.pos]}
          stroke="#22d3ee"
          strokeWidth={1}
          strokeScaleEnabled={false}
          listening={false}
        />
      ))}
    </Layer>
  );
}

// ── Initial frame fragment ────────────────────────────────────────────

interface InitialFrameFragmentProps {
  frame: InitialFramePosition;
  storeFrame: InputFrame;
  displayScale: number;
  imageMap: Map<string, HTMLImageElement>;
  isFocused: boolean;
  activeTool: string;
  setNodeRef: (frameId: string, layerId: string, node: Konva.Image | null) => void;
  snapDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onClick: (frameId: string, hasLayers: boolean) => void;
  onLayerClick: (frameId: string, layerId: string, e: Konva.KonvaEventObject<MouseEvent>) => void;
  onLayerDragEnd: (frameId: string, layerId: string, e: Konva.KonvaEventObject<DragEvent>) => void;
  onLayerTransformEnd: (frameId: string, layerId: string, e: Konva.KonvaEventObject<Event>) => void;
}

function InitialFrameFragment({
  frame,
  storeFrame,
  displayScale,
  imageMap,
  isFocused,
  activeTool,
  setNodeRef,
  snapDragMove,
  onClick,
  onLayerClick,
  onLayerDragEnd,
  onLayerTransformEnd,
}: InitialFrameFragmentProps) {
  const visibleImages = storeFrame.layers.filter(
    (l: CanvasLayer): l is ImageLayer => l.type === "image" && l.visible,
  );
  const visibleMasks = storeFrame.layers.filter(
    (l: CanvasLayer): l is MaskObjectLayer => l.type === "mask" && l.visible,
  );
  const hasLayers = visibleImages.length > 0;
  const borderColor = !hasLayers
    ? INPUT_COLOR_INACTIVE
    : storeFrame.mode === "reference"
      ? INPUT_COLOR_REFERENCE
      : INPUT_COLOR_ACTIVE;
  const handleClick = () => onClick(frame.frameId, hasLayers);

  return (
    <>
      {/* Per-frame transform group: switches the inner coordinate system from
       * display-space to pixel-space so layer.x / layer.y / scale apply as
       * authored. The group origin is the frame's display-space top-left. */}
      <Group x={frame.x} y={frame.y} scaleX={displayScale} scaleY={displayScale}>
        {/* Empty-state placeholder fill so the frame reads as a target when
         * no image is loaded. Inside the displayScale Group so the corners
         * align with the border (which is drawn outside in display space). */}
        {!hasLayers && (
          <Rect
            x={0}
            y={0}
            width={frame.frameW}
            height={frame.frameH}
            fill="#1a1a1a"
            listening={false}
          />
        )}
        {visibleImages.map((layer: ImageLayer) => {
          const img = imageMap.get(layer.id);
          if (!img) return null;
          return (
            <KonvaImage
              key={layer.id}
              ref={(node) => setNodeRef(frame.frameId, layer.id, node)}
              image={img}
              x={layer.x}
              y={layer.y}
              width={layer.naturalWidth}
              height={layer.naturalHeight}
              scaleX={layer.scaleX}
              scaleY={layer.scaleY}
              rotation={layer.rotation}
              opacity={layer.opacity}
              draggable={activeTool === "move" && !layer.locked}
              onDragMove={snapDragMove}
              onDragEnd={(e) => onLayerDragEnd(frame.frameId, layer.id, e)}
              onTransformEnd={(e) => onLayerTransformEnd(frame.frameId, layer.id, e)}
              onClick={(e) => onLayerClick(frame.frameId, layer.id, e)}
            />
          );
        })}
        {visibleMasks.map((mask: MaskObjectLayer) => {
          const img = imageMap.get(mask.id);
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
              opacity={mask.opacity}
              listening={!mask.locked}
              draggable={activeTool === "move" && !mask.locked}
              onDragMove={snapDragMove}
              onDragEnd={(e) => onLayerDragEnd(frame.frameId, mask.id, e)}
              onTransformEnd={(e) => onLayerTransformEnd(frame.frameId, mask.id, e)}
              onClick={(e) => onLayerClick(frame.frameId, mask.id, e)}
            />
          );
        })}
      </Group>

      {/* Empty-state placeholder text (display-space so font size stays
       * legible regardless of frame size). */}
      {!hasLayers && (
        <Text
          x={frame.x}
          y={frame.y + frame.displayH / 2 - 8}
          width={frame.displayW}
          align="center"
          text="Drop image or click to upload."
          fontFamily="IBM Plex Sans"
          fontSize={14}
          fill="#666"
          listening={false}
        />
      )}

      {/* Display-space hit-test rect: captures clicks anywhere over the
       * frame. Transparent so it doesn't draw over the layer pixels. */}
      <Rect
        x={frame.x}
        y={frame.y}
        width={frame.displayW}
        height={frame.displayH}
        fill="transparent"
        onClick={handleClick}
        onTap={handleClick}
      />

      {/* Frame border (display-space, fixed stroke width regardless of zoom). */}
      <Rect
        x={frame.x}
        y={frame.y}
        width={frame.displayW}
        height={frame.displayH}
        stroke={borderColor}
        strokeWidth={isFocused ? 2 : 1}
        {...(!hasLayers && { dash: [8, 4] })}
        listening={false}
      />

      {/* Corner brackets only when the frame is populated; otherwise the
       * dashed border alone signals "drop target." */}
      {hasLayers && (
        <CornerBrackets
          x={frame.x}
          y={frame.y}
          w={frame.displayW}
          h={frame.displayH}
          color={borderColor}
        />
      )}
    </>
  );
}

// ── Reference frame fragment (mother + grid of children) ──────────────

interface ReferenceFrameFragmentProps {
  frame: ReferenceFramePosition;
  storeFrame: InputFrame;
  imageMap: Map<string, HTMLImageElement>;
  isFocused: boolean;
  onClick: (frameId: string, hasRefs: boolean) => void;
  onAddCellClick: (frameId: string) => void;
}

function ReferenceFrameFragment({
  frame,
  storeFrame,
  imageMap,
  isFocused,
  onClick,
  onAddCellClick,
}: ReferenceFrameFragmentProps) {
  const hasRefs = storeFrame.references.length > 0;
  const handleMotherClick = () => onClick(frame.frameId, hasRefs);
  const handleAdd = () => onAddCellClick(frame.frameId);

  return (
    <>
      {/* Mother border + brackets (display-space). */}
      <Rect
        x={frame.x}
        y={frame.y}
        width={frame.motherW}
        height={frame.motherH}
        stroke={INPUT_COLOR_REFERENCE}
        strokeWidth={isFocused ? 2 : 1}
        listening={false}
      />
      <CornerBrackets
        x={frame.x}
        y={frame.y}
        w={frame.motherW}
        h={frame.motherH}
        color={INPUT_COLOR_REFERENCE}
      />

      {/* Mother hit-test rect (transparent). Clicks that miss a child or
       * the +Add cell route here - focus the frame, and seed the first
       * ref if the mother is empty. */}
      <Rect
        x={frame.x}
        y={frame.y}
        width={frame.motherW}
        height={frame.motherH}
        fill="transparent"
        onClick={handleMotherClick}
        onTap={handleMotherClick}
      />

      {frame.children.map((child) => {
        const storeRef = storeFrame.references.find(
          (r: InputFrame["references"][number]) => r.id === child.refId,
        );
        const img = imageMap.get(child.refId);
        // Contain-fit inside the cell using the image's natural aspect.
        let imgX = child.x;
        let imgY = child.y;
        let imgW = child.displayW;
        let imgH = child.displayH;
        if (storeRef && storeRef.naturalHeight > 0 && storeRef.naturalWidth > 0) {
          const imgAspect = storeRef.naturalWidth / storeRef.naturalHeight;
          const cellAspect = child.displayW / child.displayH;
          if (imgAspect > cellAspect) {
            imgW = child.displayW;
            imgH = child.displayW / imgAspect;
            imgY = child.y + (child.displayH - imgH) / 2;
          } else {
            imgH = child.displayH;
            imgW = child.displayH * imgAspect;
            imgX = child.x + (child.displayW - imgW) / 2;
          }
        }
        return (
          <Group key={child.refId}>
            {img && (
              <KonvaImage
                image={img}
                x={imgX}
                y={imgY}
                width={imgW}
                height={imgH}
                listening={false}
              />
            )}
            {/* Child cell border - thin, lower-alpha so children read as
             * contained inside the mother rather than sibling frames. */}
            <Rect
              x={child.x}
              y={child.y}
              width={child.displayW}
              height={child.displayH}
              stroke={INPUT_COLOR_REFERENCE}
              strokeWidth={1}
              opacity={0.6}
              listening={false}
            />
            {/* Wire-index badge in the cell's top-left. Konva Text so it
             * pans/zooms with the canvas (unlike the X-button hover
             * affordance which is DOM). */}
            <Rect
              x={child.x + 4}
              y={child.y + 4}
              width={18}
              height={14}
              fill="rgba(56, 189, 248, 0.16)"
              cornerRadius={3}
              listening={false}
            />
            <Text
              x={child.x + 4}
              y={child.y + 5}
              width={18}
              height={14}
              align="center"
              text={String(child.wireIndex)}
              fontFamily="IBM Plex Mono"
              fontSize={10}
              fill={INPUT_COLOR_REFERENCE}
              listening={false}
            />
          </Group>
        );
      })}

      {/* +Add cell when not at capacity. Dashed border + centered "+"
       * Konva Text. Hit-test rect on top so click routes here without
       * bubbling to the mother. */}
      {frame.addCellPosition && (
        <Group>
          <Rect
            x={frame.addCellPosition.x}
            y={frame.addCellPosition.y}
            width={frame.addCellPosition.w}
            height={frame.addCellPosition.h}
            fill="rgba(255, 255, 255, 0.04)"
            stroke={INPUT_COLOR_REFERENCE}
            strokeWidth={1}
            opacity={0.4}
            dash={[8, 4]}
            listening={false}
          />
          <Text
            x={frame.addCellPosition.x}
            y={frame.addCellPosition.y + frame.addCellPosition.h / 2 - 12}
            width={frame.addCellPosition.w}
            align="center"
            text="+"
            fontFamily="IBM Plex Sans"
            fontSize={24}
            fill={INPUT_COLOR_REFERENCE}
            opacity={0.7}
            listening={false}
          />
          <Rect
            x={frame.addCellPosition.x}
            y={frame.addCellPosition.y}
            width={frame.addCellPosition.w}
            height={frame.addCellPosition.h}
            fill="transparent"
            onClick={handleAdd}
            onTap={handleAdd}
          />
        </Group>
      )}
    </>
  );
}
