// Canvas-native chrome for every frame. One Konva <Layer> in display space.
// Each frame is one memoised component reading its own pictures: a composed
// frame (Initial, Control) draws them in a transform Group in frame pixels,
// a set frame (Reference, IP-Adapter) as a mother frame with a grid of cells.
//
// Picture interaction (drag, scale, rotate, select) lives here. Masks render
// on MaskLayer and the Transformer on ChromeLayer; it finds its node through
// setNodeRef.

import { memo, useCallback } from "react";
import { Group, Image as KonvaImage, Layer, Rect, Text } from "react-konva";
import { CornerBrackets } from "@/canvas/layers/CornerBrackets";
import { frameColor, PROCESSED_COLOR, UNREADABLE_COLOR } from "@/canvas/frameColors";
import { useCanvasStore } from "@/stores/canvasStore";
import { useInputStore } from "@/stores/inputStore";
import { useBlobImage } from "@/inputs/media";
import { useMapStore, type MapEntry } from "@/inputs/maps";
import type { MapSlot } from "@/lib/inputs/outline";
import { isPlaced, type Frame, type Picture, type PlacedPicture } from "@/lib/inputs/types";
import {
  useLayerInteraction,
  type LayerInteraction,
  type Snap,
} from "@/canvas/tools/useLayerInteraction";
import type {
  ComposedFramePosition,
  FramePosition,
  ReferenceChildPosition,
  SetFramePosition,
} from "@/lib/inputs/layout";
import type Konva from "konva";

type SetNodeRef = (frameId: string, layerId: string, node: Konva.Image | null) => void;

interface FrameLayerProps {
  frames: FramePosition[];
  displayScale: number;
  /** Registers each picture's node so the Transformer can attach to it. */
  setNodeRef: SetNodeRef;
  snap: Snap;
  /** An empty composed frame was clicked: open the file picker for it. */
  onPickFile?: ((frameId: string) => void) | undefined;
  /** A set frame's +Add cell, or an empty set frame, was clicked. */
  onAddCell?: ((frameId: string) => void) | undefined;
}

export function FrameLayer({
  frames,
  displayScale,
  setNodeRef,
  snap,
  onPickFile,
  onAddCell,
}: FrameLayerProps) {
  const selectedFrameId = useInputStore((s) => s.selectedFrameId);
  const draggable = useCanvasStore((s) => s.activeTool === "move");
  const interaction = useLayerInteraction(snap);

  const handleComposedClick = useCallback(
    (frameId: string, filled: boolean) => {
      useInputStore.getState().selectFrame(frameId);
      if (!filled) onPickFile?.(frameId);
    },
    [onPickFile],
  );

  const handleSetClick = useCallback(
    (frameId: string, filled: boolean) => {
      useInputStore.getState().selectFrame(frameId);
      if (!filled) onAddCell?.(frameId);
    },
    [onAddCell],
  );

  if (frames.length === 0) return null;

  return (
    <Layer>
      {frames.map((frame) =>
        frame.kind === "composed" ? (
          <ComposedFrame
            key={frame.frameId}
            frame={frame}
            displayScale={displayScale}
            isSelected={selectedFrameId === frame.frameId}
            draggable={draggable}
            setNodeRef={setNodeRef}
            interaction={interaction}
            onClick={handleComposedClick}
          />
        ) : (
          <SetFrame
            key={frame.frameId}
            frame={frame}
            isSelected={selectedFrameId === frame.frameId}
            onClick={handleSetClick}
            onAddCellClick={onAddCell}
          />
        ),
      )}
    </Layer>
  );
}

const NO_PICTURES: Picture[] = [];

function useFrame(frameId: string): Frame | undefined {
  return useInputStore((s) => s.frames.find((f) => f.id === frameId));
}

/** The map a slot is sent as, when the cache holds it. */
function useMap(slot: MapSlot | null): MapEntry | null {
  const key = slot?.state === "current" ? slot.key : null;
  return useMapStore((s) => (key ? (s.current.get(key) ?? null) : null));
}

/** The pictures a composed frame draws: its own, or its link's target's. */
function useComposedSource(frameId: string): { pictures: Picture[]; linked: boolean } {
  const pictures = useInputStore((s) => {
    const frame = s.frames.find((f) => f.id === frameId);
    if (!frame) return NO_PICTURES;
    if (frame.role === "control" && frame.link) {
      return s.frames.find((f) => f.id === frame.link?.frameId)?.pictures ?? NO_PICTURES;
    }
    return frame.pictures;
  });
  const linked = useInputStore((s) => s.frames.find((f) => f.id === frameId)?.link !== null);
  return { pictures, linked };
}

// ── Composed frame ────────────────────────────────────────────────────

interface ComposedFrameProps {
  frame: ComposedFramePosition;
  displayScale: number;
  isSelected: boolean;
  draggable: boolean;
  setNodeRef: SetNodeRef;
  interaction: LayerInteraction;
  onClick: (frameId: string, filled: boolean) => void;
}

const ComposedFrame = memo(function ComposedFrame({
  frame,
  displayScale,
  isSelected,
  draggable,
  setNodeRef,
  interaction,
  onClick,
}: ComposedFrameProps) {
  const { pictures, linked } = useComposedSource(frame.frameId);
  const map = useMap(frame.map);
  const editing = useCanvasStore((s) => s.editingFrameId === frame.frameId);
  const peeking = useCanvasStore((s) => s.peekingFrameId === frame.frameId);
  const gesture = useCanvasStore((s) => s.gestureFrameId === frame.frameId);
  const layers = pictures.filter((p): p is PlacedPicture => p.visible && isPlaced(p));
  const filled = layers.length > 0;
  // A processed frame shows its map in the pictures' place until the user
  // edits the source or points at the inset; nothing under the map listens.
  // A map that lands mid-drag waits, so the dragged node stays mounted.
  const mapShown = map !== null && !editing && !peeking && !gesture;
  const borderColor = mapShown ? PROCESSED_COLOR : frameColor(frame.role, filled);
  const handleClick = () => onClick(frame.frameId, filled);
  const handleDblClick = () => {
    if (map) useCanvasStore.getState().setEditingFrame(frame.frameId);
  };
  // A linked frame mirrors its source; the source is where its pictures move
  const editable = frame.role === "control" ? !linked : true;

  return (
    <>
      {/* Display-space hit-test rect under the pictures: it takes the clicks
       * no picture takes, which is every click while the map is shown. */}
      <Rect
        x={frame.x}
        y={frame.y}
        width={frame.displayW}
        height={frame.displayH}
        fill="transparent"
        onClick={handleClick}
        onTap={handleClick}
        onDblClick={handleDblClick}
        onDblTap={handleDblClick}
      />

      {/* Per-frame transform group: switches the inner coordinate system from
       * display space to frame pixels, so each picture's placement applies as
       * stored. The group origin is the frame's display-space top-left. */}
      <Group x={frame.x} y={frame.y} scaleX={displayScale} scaleY={displayScale}>
        {!filled && (
          <Rect
            x={0}
            y={0}
            width={frame.frameW}
            height={frame.frameH}
            fill="#1a1a1a"
            listening={false}
          />
        )}
        {mapShown ? (
          <MapNode map={map} width={frame.frameW} height={frame.frameH} />
        ) : (
          layers.map((picture) => (
            <PictureNode
              key={picture.id}
              frameId={frame.frameId}
              picture={picture}
              draggable={draggable && editable && !picture.locked}
              listening={editable}
              setNodeRef={setNodeRef}
              interaction={interaction}
            />
          ))
        )}
      </Group>

      {!filled && (
        <Text
          x={frame.x}
          y={frame.y + frame.displayH / 2 - 8}
          width={frame.displayW}
          align="center"
          text={linked ? "Its source frame holds no picture." : "Drop image or click to upload."}
          fontFamily="IBM Plex Sans"
          fontSize={14}
          fill="#666"
          listening={false}
        />
      )}

      <Rect
        x={frame.x}
        y={frame.y}
        width={frame.displayW}
        height={frame.displayH}
        stroke={borderColor}
        strokeWidth={isSelected ? 2 : 1}
        {...(!filled && { dash: [8, 4] })}
        listening={false}
      />

      {filled && (
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
});

/** A frame's map, stretched over the frame in frame pixels. */
const MapNode = memo(function MapNode({
  map,
  width,
  height,
}: {
  map: MapEntry;
  width: number;
  height: number;
}) {
  const image = useBlobImage(map.blob);
  if (!image) return null;
  return <KonvaImage image={image} x={0} y={0} width={width} height={height} listening={false} />;
});

interface PictureNodeProps {
  frameId: string;
  picture: PlacedPicture;
  draggable: boolean;
  listening: boolean;
  setNodeRef: SetNodeRef;
  interaction: LayerInteraction;
}

/** One layer of a composed frame, in frame pixels. The placement here must
 * match what flattenCanvas draws. */
const PictureNode = memo(function PictureNode({
  frameId,
  picture,
  draggable,
  listening,
  setNodeRef,
  interaction,
}: PictureNodeProps) {
  const image = useBlobImage(picture.file);
  const nodeRef = useCallback(
    (node: Konva.Image | null) => setNodeRef(frameId, picture.id, node),
    [frameId, picture.id, setNodeRef],
  );
  const { transform } = picture;
  const placement = {
    x: transform.x,
    y: transform.y,
    width: picture.width,
    height: picture.height,
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
    rotation: transform.rotation,
  };

  if (!picture.file) {
    // Bytes that could not be read: hold the layer's place and say so
    return (
      <Group {...placement} listening={false}>
        <Rect
          width={picture.width}
          height={picture.height}
          fill="rgba(248, 113, 113, 0.08)"
          stroke={UNREADABLE_COLOR}
          strokeWidth={2}
          strokeScaleEnabled={false}
          dash={[8, 4]}
        />
        <Text
          width={picture.width}
          height={picture.height}
          align="center"
          verticalAlign="middle"
          text={`${picture.name}\ncould not be read`}
          fontFamily="IBM Plex Sans"
          fontSize={Math.max(14, picture.height / 24)}
          fill={UNREADABLE_COLOR}
        />
      </Group>
    );
  }
  if (!image) return null;
  if (!listening) {
    return <KonvaImage image={image} {...placement} opacity={picture.opacity} listening={false} />;
  }
  return (
    <KonvaImage
      ref={nodeRef}
      image={image}
      {...placement}
      opacity={picture.opacity}
      draggable={draggable}
      onDragStart={() => interaction.onLayerGestureStart(frameId)}
      onTransformStart={() => interaction.onLayerGestureStart(frameId)}
      onDragMove={interaction.onLayerDragMove}
      onDragEnd={(e) => interaction.onLayerDragEnd(frameId, picture.id, e)}
      onTransformEnd={(e) => interaction.onLayerTransformEnd(frameId, picture.id, e)}
      onClick={(e) => interaction.onLayerClick(frameId, picture.id, e)}
    />
  );
});

// ── Set frame (mother + grid of cells) ────────────────────────────────

interface SetFrameProps {
  frame: SetFramePosition;
  isSelected: boolean;
  onClick: (frameId: string, filled: boolean) => void;
  onAddCellClick: ((frameId: string) => void) | undefined;
}

const SetFrame = memo(function SetFrame({
  frame,
  isSelected,
  onClick,
  onAddCellClick,
}: SetFrameProps) {
  const pictures = useFrame(frame.frameId)?.pictures ?? NO_PICTURES;
  const color = frameColor(frame.role, true);
  const handleMotherClick = () => onClick(frame.frameId, frame.children.length > 0);
  const handleAdd = () => onAddCellClick?.(frame.frameId);

  return (
    <>
      <Rect
        x={frame.x}
        y={frame.y}
        width={frame.motherW}
        height={frame.motherH}
        stroke={color}
        strokeWidth={isSelected ? 2 : 1}
        listening={false}
      />
      <CornerBrackets x={frame.x} y={frame.y} w={frame.motherW} h={frame.motherH} color={color} />

      {/* Clicks that miss a cell or the +Add cell land here: select the frame,
       * and pick a file when it is empty. */}
      <Rect
        x={frame.x}
        y={frame.y}
        width={frame.motherW}
        height={frame.motherH}
        fill="transparent"
        onClick={handleMotherClick}
        onTap={handleMotherClick}
      />

      {frame.children.map((cell) => {
        const picture = pictures.find((p) => p.id === cell.refId);
        return picture ? (
          <SetCell key={cell.refId} cell={cell} picture={picture} color={color} />
        ) : null;
      })}

      {frame.addCellPosition && (
        <Group>
          <Rect
            x={frame.addCellPosition.x}
            y={frame.addCellPosition.y}
            width={frame.addCellPosition.w}
            height={frame.addCellPosition.h}
            fill="rgba(255, 255, 255, 0.04)"
            stroke={color}
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
            fill={color}
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
});

interface SetCellProps {
  cell: ReferenceChildPosition;
  picture: Picture;
  color: string;
}

/** One picture of a set frame, fitted inside its cell, or its map when the
 * cache holds it. A hidden one is dimmed and carries no number; the DOM
 * overlay above it says why. */
const SetCell = memo(function SetCell({ cell, picture, color }: SetCellProps) {
  const map = useMap(cell.map);
  const image = useBlobImage(map?.blob ?? picture.file);
  // Contain-fit inside the cell using the picture's natural aspect.
  let imgX = cell.x;
  let imgY = cell.y;
  let imgW = cell.displayW;
  let imgH = cell.displayH;
  if (picture.height > 0 && picture.width > 0) {
    const imgAspect = picture.width / picture.height;
    const cellAspect = cell.displayW / cell.displayH;
    if (imgAspect > cellAspect) {
      imgW = cell.displayW;
      imgH = cell.displayW / imgAspect;
      imgY = cell.y + (cell.displayH - imgH) / 2;
    } else {
      imgH = cell.displayH;
      imgW = cell.displayH * imgAspect;
      imgX = cell.x + (cell.displayW - imgW) / 2;
    }
  }
  const cellColor = !picture.file ? UNREADABLE_COLOR : map ? PROCESSED_COLOR : color;
  return (
    <Group>
      {image && (
        <KonvaImage
          image={image}
          x={imgX}
          y={imgY}
          width={imgW}
          height={imgH}
          opacity={picture.visible ? 1 : 0.3}
          listening={false}
        />
      )}
      {!picture.file && (
        <Text
          x={cell.x}
          y={cell.y}
          width={cell.displayW}
          height={cell.displayH}
          align="center"
          verticalAlign="middle"
          text="could not be read"
          fontFamily="IBM Plex Sans"
          fontSize={11}
          fill={UNREADABLE_COLOR}
          listening={false}
        />
      )}
      <Rect
        x={cell.x}
        y={cell.y}
        width={cell.displayW}
        height={cell.displayH}
        stroke={cellColor}
        strokeWidth={1}
        opacity={0.6}
        {...(!picture.file && { dash: [6, 4] })}
        listening={false}
      />
      {/* The number a prompt uses for this picture, in the cell's top-left. */}
      {cell.wireIndex !== null && (
        <>
          <Rect
            x={cell.x + 4}
            y={cell.y + 4}
            width={18}
            height={14}
            fill="rgba(56, 189, 248, 0.16)"
            cornerRadius={3}
            listening={false}
          />
          <Text
            x={cell.x + 4}
            y={cell.y + 5}
            width={18}
            height={14}
            align="center"
            text={String(cell.wireIndex)}
            fontFamily="IBM Plex Mono"
            fontSize={10}
            fill={color}
            listening={false}
          />
        </>
      )}
    </Group>
  );
});
