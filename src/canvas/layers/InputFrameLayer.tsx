// Canvas-native chrome for the Input frame stack. One Konva <Layer> in
// display space (no displayScale Group at the layer root), as
// ControlFrameLayer does it. Each frame is one memoised component reading its
// own pictures: an Initial frame draws them in a transform Group in frame
// pixels, a Reference frame as a mother frame with a grid of cells.
//
// Picture interaction (drag, scale, rotate, select) lives here. Masks render
// on MaskLayer and the Transformer on ChromeLayer; it finds its node through
// setNodeRef.

import { memo, useCallback } from "react";
import { Group, Image as KonvaImage, Layer, Rect, Text } from "react-konva";
import {
  INPUT_COLOR_ACTIVE,
  INPUT_COLOR_INACTIVE,
  INPUT_COLOR_REFERENCE,
} from "@/canvas/ControlFramePanel";
import { CornerBrackets } from "@/canvas/layers/ControlFrameLayer";
import { useCanvasStore } from "@/stores/canvasStore";
import { useInputStore } from "@/stores/inputStore";
import { useBlobImage } from "@/inputs/media";
import { isPlaced, type Picture, type PlacedPicture } from "@/lib/inputs/types";
import {
  useLayerInteraction,
  type LayerInteraction,
  type Snap,
} from "@/canvas/tools/useLayerInteraction";
import type {
  InitialFramePosition,
  InputFramePosition,
  ReferenceChildPosition,
  ReferenceFramePosition,
} from "@/canvas/inputFrameTypes";
import type Konva from "konva";

type SetNodeRef = (frameId: string, layerId: string, node: Konva.Image | null) => void;

const UNREADABLE = "#f87171";

interface InputFrameLayerProps {
  frames: InputFramePosition[];
  displayScale: number;
  /** Registers each picture's node so the Transformer can attach to it. */
  setNodeRef: SetNodeRef;
  snap: Snap;
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
  setNodeRef,
  snap,
  onPickInputFile,
  onAddReferenceChild,
}: InputFrameLayerProps) {
  const selectedFrameId = useInputStore((s) => s.selectedFrameId);
  const draggable = useCanvasStore((s) => s.activeTool === "move");
  const interaction = useLayerInteraction(snap);

  const handleInitialClick = useCallback(
    (frameId: string, filled: boolean) => {
      useInputStore.getState().selectFrame(frameId);
      if (!filled) onPickInputFile?.(frameId);
    },
    [onPickInputFile],
  );

  const handleReferenceClick = useCallback(
    (frameId: string, filled: boolean) => {
      useInputStore.getState().selectFrame(frameId);
      if (!filled) onAddReferenceChild?.(frameId);
    },
    [onAddReferenceChild],
  );

  if (frames.length === 0) return null;

  return (
    <Layer>
      {frames.map((frame) =>
        frame.kind === "initial" ? (
          <InitialFrame
            key={frame.frameId}
            frame={frame}
            displayScale={displayScale}
            isSelected={selectedFrameId === frame.frameId}
            draggable={draggable}
            setNodeRef={setNodeRef}
            interaction={interaction}
            onClick={handleInitialClick}
          />
        ) : (
          <ReferenceFrame
            key={frame.frameId}
            frame={frame}
            isSelected={selectedFrameId === frame.frameId}
            onClick={handleReferenceClick}
            onAddCellClick={onAddReferenceChild}
          />
        ),
      )}
    </Layer>
  );
}

function useFramePictures(frameId: string): Picture[] {
  return useInputStore((s) => s.frames.find((f) => f.id === frameId)?.pictures) ?? NO_PICTURES;
}

const NO_PICTURES: Picture[] = [];

// ── Initial frame ─────────────────────────────────────────────────────

interface InitialFrameProps {
  frame: InitialFramePosition;
  displayScale: number;
  isSelected: boolean;
  draggable: boolean;
  setNodeRef: SetNodeRef;
  interaction: LayerInteraction;
  onClick: (frameId: string, filled: boolean) => void;
}

const InitialFrame = memo(function InitialFrame({
  frame,
  displayScale,
  isSelected,
  draggable,
  setNodeRef,
  interaction,
  onClick,
}: InitialFrameProps) {
  const pictures = useFramePictures(frame.frameId);
  const layers = pictures.filter((p): p is PlacedPicture => p.visible && isPlaced(p));
  const filled = layers.length > 0;
  const borderColor = filled ? INPUT_COLOR_ACTIVE : INPUT_COLOR_INACTIVE;
  const handleClick = () => onClick(frame.frameId, filled);

  return (
    <>
      {/* Per-frame transform group: switches the inner coordinate system from
       * display space to frame pixels, so each picture's placement applies as
       * stored. The group origin is the frame's display-space top-left. */}
      <Group x={frame.x} y={frame.y} scaleX={displayScale} scaleY={displayScale}>
        {/* Empty-state fill so the frame reads as a target when it holds
         * nothing. Inside the Group so its corners align with the border. */}
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
        {layers.map((picture) => (
          <PictureNode
            key={picture.id}
            frameId={frame.frameId}
            picture={picture}
            draggable={draggable && !picture.locked}
            setNodeRef={setNodeRef}
            interaction={interaction}
          />
        ))}
      </Group>

      {/* Empty-state text in display space, so its size stays legible
       * whatever the frame size. */}
      {!filled && (
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

      {/* Frame border (display space, fixed stroke width regardless of zoom). */}
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

      {/* Corner brackets only when the frame is populated; otherwise the
       * dashed border alone signals "drop target." */}
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

interface PictureNodeProps {
  frameId: string;
  picture: PlacedPicture;
  draggable: boolean;
  setNodeRef: SetNodeRef;
  interaction: LayerInteraction;
}

/** One layer of an Initial frame, in frame pixels. The placement here must
 * match what flattenCanvas draws. */
const PictureNode = memo(function PictureNode({
  frameId,
  picture,
  draggable,
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
          stroke={UNREADABLE}
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
          fill={UNREADABLE}
        />
      </Group>
    );
  }
  if (!image) return null;
  return (
    <KonvaImage
      ref={nodeRef}
      image={image}
      {...placement}
      opacity={picture.opacity}
      draggable={draggable}
      onDragMove={interaction.onLayerDragMove}
      onDragEnd={(e) => interaction.onLayerDragEnd(frameId, picture.id, e)}
      onTransformEnd={(e) => interaction.onLayerTransformEnd(frameId, picture.id, e)}
      onClick={(e) => interaction.onLayerClick(frameId, picture.id, e)}
    />
  );
});

// ── Reference frame (mother + grid of cells) ──────────────────────────

interface ReferenceFrameProps {
  frame: ReferenceFramePosition;
  isSelected: boolean;
  onClick: (frameId: string, filled: boolean) => void;
  onAddCellClick: ((frameId: string) => void) | undefined;
}

const ReferenceFrame = memo(function ReferenceFrame({
  frame,
  isSelected,
  onClick,
  onAddCellClick,
}: ReferenceFrameProps) {
  const pictures = useFramePictures(frame.frameId);
  const handleMotherClick = () => onClick(frame.frameId, frame.children.length > 0);
  const handleAdd = () => onAddCellClick?.(frame.frameId);

  return (
    <>
      {/* Mother border + brackets (display space). */}
      <Rect
        x={frame.x}
        y={frame.y}
        width={frame.motherW}
        height={frame.motherH}
        stroke={INPUT_COLOR_REFERENCE}
        strokeWidth={isSelected ? 2 : 1}
        listening={false}
      />
      <CornerBrackets
        x={frame.x}
        y={frame.y}
        w={frame.motherW}
        h={frame.motherH}
        color={INPUT_COLOR_REFERENCE}
      />

      {/* Mother hit-test rect (transparent). Clicks that miss a cell or the
       * +Add cell land here: select the frame, and pick a file when it is
       * empty. */}
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
        return picture ? <ReferenceCell key={cell.refId} cell={cell} picture={picture} /> : null;
      })}

      {/* +Add cell when not at capacity. Dashed border + centered "+"
       * Konva Text. Hit-test rect on top so the click lands here and not on
       * the mother. */}
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
});

interface ReferenceCellProps {
  cell: ReferenceChildPosition;
  picture: Picture;
}

/** One picture of a Reference frame, fitted inside its cell. A hidden one is
 * dimmed and carries no number; the DOM overlay above it says why. */
const ReferenceCell = memo(function ReferenceCell({ cell, picture }: ReferenceCellProps) {
  const image = useBlobImage(picture.file);
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
  const color = picture.file ? INPUT_COLOR_REFERENCE : UNREADABLE;
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
          fill={UNREADABLE}
          listening={false}
        />
      )}
      {/* Cell border - thin, lower-alpha so cells read as contained inside
       * the mother rather than sibling frames. */}
      <Rect
        x={cell.x}
        y={cell.y}
        width={cell.displayW}
        height={cell.displayH}
        stroke={color}
        strokeWidth={1}
        opacity={0.6}
        {...(!picture.file && { dash: [6, 4] })}
        listening={false}
      />
      {/* The number a prompt uses for this picture, in the cell's top-left.
       * Konva Text so it pans and zooms with the canvas. */}
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
            fill={INPUT_COLOR_REFERENCE}
            listening={false}
          />
        </>
      )}
    </Group>
  );
});
