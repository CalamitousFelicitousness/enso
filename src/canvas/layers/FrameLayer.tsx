import { useCallback } from "react";
import { Layer, Group, Rect, Text } from "react-konva";
import { useGenerationStore } from "@/stores/generationStore";
import { useCanvasStore } from "@/stores/canvasStore";
import {
  INPUT_COLOR_ACTIVE,
  INPUT_COLOR_REFERENCE,
  INPUT_COLOR_INACTIVE,
} from "@/canvas/ControlFramePanel";
import { CornerBrackets } from "@/canvas/layers/ControlFrameLayer";

interface FrameLayerProps {
  displayScale: number;
  onPickImage?: () => void;
}

export function FrameLayer({ displayScale, onPickImage }: FrameLayerProps) {
  const frameW = useGenerationStore((s) => s.width);
  const frameH = useGenerationStore((s) => s.height);
  const hasLayers = useCanvasStore((s) => s.layers.length > 0);
  const inputRole = useCanvasStore((s) => s.inputRole);
  const borderColor = !hasLayers
    ? INPUT_COLOR_INACTIVE
    : inputRole === "reference"
      ? INPUT_COLOR_REFERENCE
      : INPUT_COLOR_ACTIVE;

  const handleClick = useCallback(
    (e: import("konva/lib/Node").KonvaEventObject<MouseEvent>) => {
      if (e.evt.button !== 0) return;
      if (!hasLayers && onPickImage) onPickImage();
    },
    [hasLayers, onPickImage],
  );

  const handleTap = useCallback(() => {
    if (!hasLayers && onPickImage) onPickImage();
  }, [hasLayers, onPickImage]);

  return (
    <Layer>
      <Group scaleX={displayScale} scaleY={displayScale}>
        {/* Clickable background when empty */}
        {!hasLayers && (
          <Rect
            x={0}
            y={0}
            width={frameW}
            height={frameH}
            fill="#1a1a1a"
            listening={true}
            onClick={handleClick}
            onTap={handleTap}
          />
        )}

        {/* Placeholder text when no images */}
        {!hasLayers && (
          <Text
            x={0}
            y={frameH / 2 - 8}
            width={frameW}
            align="center"
            text="Drop image or click to upload."
            fontFamily="IBM Plex Sans"
            fontSize={14 / displayScale}
            fill="#666"
            listening={false}
          />
        )}

        {/* Border */}
        <Rect
          x={0}
          y={0}
          width={frameW}
          height={frameH}
          stroke={borderColor}
          strokeWidth={1 / displayScale}
          dash={hasLayers ? undefined : [8 / displayScale, 4 / displayScale]}
          listening={false}
        />

        {/* Corner brackets (only when has content) */}
        {hasLayers && (
          <CornerBrackets
            x={0}
            y={0}
            w={frameW}
            h={frameH}
            color={borderColor}
            size={12 / displayScale}
            offset={2 / displayScale}
            strokeWidth={1.5}
            strokeScaleEnabled={false}
          />
        )}
      </Group>
    </Layer>
  );
}
