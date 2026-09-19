export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A layer's placement, as Konva and Canvas 2D apply it: translate, then
 * rotate (degrees), then scale, around the layer's top-left corner. */
export interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

/** Integer frame-space bounds of a placed layer, grown by one pixel for
 * antialiasing and clamped to the frame. Null when nothing lands in frame. */
export function placedBounds(p: Placement, frameW: number, frameH: number): Rect | null {
  const rad = (p.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [cx, cy] of [
    [0, 0],
    [p.width, 0],
    [p.width, p.height],
    [0, p.height],
  ]) {
    const sx = cx * p.scaleX;
    const sy = cy * p.scaleY;
    const x = sx * cos - sy * sin + p.x;
    const y = sx * sin + sy * cos + p.y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const x0 = Math.max(0, Math.floor(minX) - 1);
  const y0 = Math.max(0, Math.floor(minY) - 1);
  const x1 = Math.min(frameW, Math.ceil(maxX) + 1);
  const y1 = Math.min(frameH, Math.ceil(maxY) + 1);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
