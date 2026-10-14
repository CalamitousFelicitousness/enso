import { useCallback } from "react";
import { Layer, Group, Rect, Text, Image as KonvaImage } from "react-konva";
import { useVideoCanvasStore } from "@/stores/videoCanvasStore";
import { useEffectiveLimit } from "@/inputs/admit";
import { useBlobImage } from "@/inputs/media";
import { tooLargeToShowText } from "@/lib/inputs/text";

const ACTIVE_COLOR = "#4ade80";
const INACTIVE_COLOR = "#6b7280";

interface VideoFrameLayerProps {
  which: "init" | "last";
  offsetX: number;
  width: number;
  height: number;
  onPickImage?: () => void;
}

export function VideoFrameLayer({
  which,
  offsetX,
  width,
  height,
  onPickImage,
}: VideoFrameLayerProps) {
  const frame = useVideoCanvasStore((s) => (which === "init" ? s.initFrame : s.lastFrame));
  const size = frame ? { width: frame.naturalWidth, height: frame.naturalHeight } : null;
  const image = useBlobImage(frame?.file ?? null, size);
  const limit = useEffectiveLimit();
  const tooLarge = size !== null && size.width * size.height > limit.pixels;

  const hasImage = !!frame && !!image;

  const handleClick = useCallback(
    (e: import("konva/lib/Node").KonvaEventObject<MouseEvent>) => {
      if (e.evt.button !== 0) return;
      if (!hasImage && onPickImage) onPickImage();
    },
    [hasImage, onPickImage],
  );

  const handleTap = useCallback(() => {
    if (!hasImage && onPickImage) onPickImage();
  }, [hasImage, onPickImage]);

  return (
    <Layer>
      <Group x={offsetX}>
        {/* Dark background when empty - clickable */}
        {!hasImage && (
          <Rect
            x={0}
            y={0}
            width={width}
            height={height}
            fill="#1a1a1a"
            listening={true}
            onClick={handleClick}
            onTap={handleTap}
          />
        )}

        {/* Placeholder text */}
        {!hasImage && (
          <Text
            x={0}
            y={height / 2 - 8}
            width={width}
            align="center"
            text={
              frame && size && tooLarge
                ? tooLargeToShowText(frame.file.name, size)
                : "Drop image or click"
            }
            fontFamily="IBM Plex Sans"
            fontSize={14}
            fill="#666"
            listening={false}
          />
        )}

        {/* Image scaled to fit frame */}
        {hasImage && (
          <KonvaImage image={image} x={0} y={0} width={width} height={height} listening={false} />
        )}

        {/* Border */}
        <Rect
          x={0}
          y={0}
          width={width}
          height={height}
          stroke={hasImage ? ACTIVE_COLOR : INACTIVE_COLOR}
          strokeWidth={2}
          {...(!hasImage && { dash: [8, 4] })}
          listening={false}
        />
      </Group>
    </Layer>
  );
}
