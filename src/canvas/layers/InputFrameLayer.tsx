// New canvas-native chrome for the multi-Input-frame stack. One Konva
// <Layer> rendering display-space top-level (no displayScale Group wrapper
// at the layer root), mirroring ControlFrameLayer's convention. Each frame
// becomes one fragment: Initial frames carry a transform Group with layer
// KonvaImages in pixel-space; Reference frames render as a "mother frame
// with grid of children" per the user's mockup.
//
// Mounted below the legacy FrameLayer + ReferenceImageLayer +
// CompositeLayer so the legacy chrome still draws on top and visible
// behavior is unchanged. removes the legacy mounts and this layer
// becomes the only input-side chrome. absorbs CompositeLayer's
// Transformer + the active mask stroke into this layer.

import { useCallback, useEffect, useState } from "react";
import { Group, Image as KonvaImage, Layer, Rect, Text } from "react-konva";
import {
  INPUT_COLOR_ACTIVE,
  INPUT_COLOR_INACTIVE,
  INPUT_COLOR_REFERENCE,
} from "@/canvas/ControlFramePanel";
import { CornerBrackets } from "@/canvas/layers/ControlFrameLayer";
import { useCanvasStore } from "@/stores/canvasStore";
import type { CanvasLayer, ImageLayer, MaskObjectLayer } from "@/stores/canvasStore";
import type { InputFrame } from "@/canvas/inputFrames";
import type {
  InitialFramePosition,
  InputFramePosition,
  ReferenceFramePosition,
} from "@/canvas/inputFrameTypes";

interface InputFrameLayerProps {
  frames: InputFramePosition[];
  displayScale: number;
  /** Called when an empty Initial frame is clicked - opens the file picker
   * targeted at that frame. leaves this optional so CanvasStage can
   * mount the layer dormantly; a follow-up wires it up. */
  onPickInputFile?: (frameId: string) => void;
  /** Called when a Reference mother's +Add cell is clicked, or when an
   * empty Reference mother is clicked. */
  onAddReferenceChild?: (frameId: string) => void;
}

export function InputFrameLayer({
  frames,
  displayScale,
  onPickInputFile,
  onAddReferenceChild,
}: InputFrameLayerProps) {
  const storeFrames = useCanvasStore((s) => s.inputFrames);
  const focusedInputFrameId = useCanvasStore((s) => s.activeInputFrameId);
  const setActiveInputFrame = useCanvasStore((s) => s.setActiveInputFrame);

  // Preload HTMLImageElement for every visible image across every frame.
  // The store already owns the object URLs (imageData fields are populated
  // by addImageLayer / appendReferenceToFrame and revoked by their remove
  // counterparts), so this hook only manages the HTMLImageElement preload
  // cache - no URL lifecycle.
  //
  // Idempotent diff against the current imageMap: when expected ids equal
  // cached ids the effect short-circuits, preventing the [storeFrames,
  // imageMap] dependency pair from looping.
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
              onClick={handleInitialClick}
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
  onClick: (frameId: string, hasLayers: boolean) => void;
}

function InitialFrameFragment({
  frame,
  storeFrame,
  displayScale,
  imageMap,
  isFocused,
  onClick,
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
              image={img}
              x={layer.x}
              y={layer.y}
              width={layer.naturalWidth}
              height={layer.naturalHeight}
              scaleX={layer.scaleX}
              scaleY={layer.scaleY}
              rotation={layer.rotation}
              opacity={layer.opacity}
              listening={false}
            />
          );
        })}
        {visibleMasks.map((mask: MaskObjectLayer) => {
          const img = imageMap.get(mask.id);
          if (!img) return null;
          return (
            <KonvaImage
              key={mask.id}
              image={img}
              x={mask.x}
              y={mask.y}
              width={mask.width}
              height={mask.height}
              scaleX={mask.scaleX}
              scaleY={mask.scaleY}
              rotation={mask.rotation}
              opacity={mask.opacity}
              listening={false}
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
