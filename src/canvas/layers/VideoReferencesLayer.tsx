import { useEffect, useState } from "react";
import { Layer, Group, Rect, Text, Image as KonvaImage } from "react-konva";
import { useVideoCanvasStore, type VideoFrameImage } from "@/stores/videoCanvasStore";
import type { ReferenceChildPosition } from "@/canvas/inputFrameTypes";

const ACTIVE_COLOR = "#a78bfa";
const INACTIVE_COLOR = "#6b7280";
const BADGE_SIZE = 16;

interface VideoReferencesLayerProps {
  offsetX: number;
  width: number;
  height: number;
  cells: ReferenceChildPosition[];
  addCell: { x: number; y: number; w: number; h: number } | null;
  onPickAdd?: () => void;
}

function ReferenceChild({ frame, pos }: { frame: VideoFrameImage; pos: ReferenceChildPosition }) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = new window.Image();
    img.onload = () => setImage(img);
    img.src = frame.objectUrl;
  }, [frame.objectUrl]);

  const scale =
    frame.naturalWidth > 0 && frame.naturalHeight > 0
      ? Math.min(pos.displayW / frame.naturalWidth, pos.displayH / frame.naturalHeight)
      : 1;
  const drawW = frame.naturalWidth * scale;
  const drawH = frame.naturalHeight * scale;

  return (
    <Group x={pos.x} y={pos.y}>
      <Rect x={0} y={0} width={pos.displayW} height={pos.displayH} fill="#111" listening={false} />
      {image && (
        <KonvaImage
          image={image}
          x={(pos.displayW - drawW) / 2}
          y={(pos.displayH - drawH) / 2}
          width={drawW}
          height={drawH}
          listening={false}
        />
      )}
      <Rect
        x={0}
        y={0}
        width={pos.displayW}
        height={pos.displayH}
        stroke={ACTIVE_COLOR}
        strokeWidth={1}
        listening={false}
      />
      {/* 1-based <Picture N> wire address; order is load-bearing for ref2va */}
      <Rect
        x={0}
        y={0}
        width={BADGE_SIZE}
        height={BADGE_SIZE}
        fill={ACTIVE_COLOR}
        listening={false}
      />
      <Text
        x={0}
        y={2}
        width={BADGE_SIZE}
        align="center"
        text={String(pos.wireIndex)}
        fontFamily="IBM Plex Sans"
        fontSize={11}
        fontStyle="bold"
        fill="#1a1a1a"
        listening={false}
      />
    </Group>
  );
}

export function VideoReferencesLayer({
  offsetX,
  width,
  height,
  cells,
  addCell,
  onPickAdd,
}: VideoReferencesLayerProps) {
  const references = useVideoCanvasStore((s) => s.references);
  const byId = new Map(references.map((r) => [r.id, r]));
  const hasAny = cells.length > 0;

  return (
    <Layer>
      <Group x={offsetX}>
        <Rect x={0} y={0} width={width} height={height} fill="#1a1a1a" listening={false} />
        {!hasAny && (
          <Text
            x={0}
            y={height / 2 - 8}
            width={width}
            align="center"
            text="Drop reference images or click"
            fontFamily="IBM Plex Sans"
            fontSize={14}
            fill="#666"
            listening={false}
          />
        )}
        {cells.map((pos) => {
          const frame = byId.get(pos.refId);
          return frame ? <ReferenceChild key={pos.refId} frame={frame} pos={pos} /> : null;
        })}
        {addCell && (
          <Group x={addCell.x} y={addCell.y}>
            <Rect
              x={0}
              y={0}
              width={addCell.w}
              height={addCell.h}
              stroke={INACTIVE_COLOR}
              strokeWidth={1}
              dash={[6, 4]}
              listening={true}
              onClick={(e) => {
                if (e.evt.button === 0) onPickAdd?.();
              }}
              onTap={() => onPickAdd?.()}
            />
            <Text
              x={0}
              y={addCell.h / 2 - 8}
              width={addCell.w}
              align="center"
              text="+"
              fontFamily="IBM Plex Sans"
              fontSize={16}
              fill="#666"
              listening={false}
            />
          </Group>
        )}
        {!hasAny && (
          <Rect
            x={0}
            y={0}
            width={width}
            height={height}
            stroke={INACTIVE_COLOR}
            strokeWidth={2}
            dash={[8, 4]}
            listening={true}
            onClick={(e) => {
              if (e.evt.button === 0) onPickAdd?.();
            }}
            onTap={() => onPickAdd?.()}
          />
        )}
        {hasAny && (
          <Rect
            x={0}
            y={0}
            width={width}
            height={height}
            stroke={ACTIVE_COLOR}
            strokeWidth={2}
            listening={false}
          />
        )}
      </Group>
    </Layer>
  );
}
