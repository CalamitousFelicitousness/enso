// Topmost Konva Layer: the brush cursor, the Transformer and the snap
// guides. Kept apart from the mask layer so none of it inherits the mask
// alpha, and above it so handles stay visible over masks.

import { Circle as KonvaCircle, Group, Layer, Line, Transformer } from "react-konva";
import type { Snap } from "@/canvas/tools/useLayerInteraction";
import type { InitialFramePosition } from "@/canvas/inputFrameTypes";
import type Konva from "konva";

interface ChromeLayerProps {
  /** Focused Initial frame; the cursor lives in its pixel space. */
  focusedFrame: InitialFramePosition | undefined;
  displayScale: number;
  trRef: React.RefObject<Konva.Transformer | null>;
  snap: Snap;
  setCursorNode?: ((node: Konva.Circle | null) => void) | undefined;
}

export function ChromeLayer({
  focusedFrame,
  displayScale,
  trRef,
  snap,
  setCursorNode,
}: ChromeLayerProps) {
  return (
    <Layer>
      {focusedFrame && setCursorNode && (
        <Group
          x={focusedFrame.x}
          y={focusedFrame.y}
          scaleX={displayScale}
          scaleY={displayScale}
          listening={false}
        >
          <KonvaCircle
            ref={setCursorNode}
            x={0}
            y={0}
            radius={10}
            stroke="#fff"
            strokeWidth={1 / displayScale}
            dash={[4 / displayScale, 4 / displayScale]}
            visible={false}
            listening={false}
          />
        </Group>
      )}

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
