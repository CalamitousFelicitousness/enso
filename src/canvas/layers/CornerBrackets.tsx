import { Line } from "react-konva";

interface CornerBracketsProps {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  size?: number;
  offset?: number;
  strokeWidth?: number;
  strokeScaleEnabled?: boolean;
}

/** Four L-shaped marks just outside a frame's corners. */
export function CornerBrackets({
  x,
  y,
  w,
  h,
  color,
  size = 12,
  offset = 2,
  strokeWidth = 1.5,
  strokeScaleEnabled = false,
}: CornerBracketsProps) {
  const s = size;
  const o = offset;
  const shared = {
    stroke: color,
    strokeWidth,
    strokeScaleEnabled,
    listening: false as const,
    lineCap: "round" as const,
  };
  return (
    <>
      <Line points={[x - o, y - o + s, x - o, y - o, x - o + s, y - o]} {...shared} />
      <Line points={[x + w + o - s, y - o, x + w + o, y - o, x + w + o, y - o + s]} {...shared} />
      <Line points={[x - o, y + h + o - s, x - o, y + h + o, x - o + s, y + h + o]} {...shared} />
      <Line
        points={[x + w + o - s, y + h + o, x + w + o, y + h + o, x + w + o, y + h + o - s]}
        {...shared}
      />
    </>
  );
}
