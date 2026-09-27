import type { InputFrame } from "@/canvas/inputFrames";
import type { CanvasLayer, ImageLayer, MaskObjectLayer } from "@/stores/canvasStore";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Axis-aligned bounds of an image layer, transformed as flattenCanvas draws
 * it: translate, rotate, scale, then the natural-size image at the origin. */
function imageBounds(layer: ImageLayer): Box {
  const rad = (layer.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const w = layer.naturalWidth * layer.scaleX;
  const h = layer.naturalHeight * layer.scaleY;
  const xs = [0, w * cos, -h * sin, w * cos - h * sin];
  const ys = [0, w * sin, h * cos, w * sin + h * cos];
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: layer.x + minX,
    y: layer.y + minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

function isPlaced(layer: CanvasLayer): layer is ImageLayer | MaskObjectLayer {
  return layer.type === "image" || layer.type === "mask";
}

/** Uniform scale s, then offset (tx, ty). */
interface Fit {
  s: number;
  tx: number;
  ty: number;
}

/** The fit that puts an image layer inside width x height, centred; null for
 * an image with no area. */
function fitTransform(layer: ImageLayer, width: number, height: number): Fit | null {
  const box = imageBounds(layer);
  if (box.width <= 0 || box.height <= 0) return null;
  const s = Math.min(width / box.width, height / box.height);
  return {
    s,
    tx: (width - box.width * s) / 2 - box.x * s,
    ty: (height - box.height * s) / 2 - box.y * s,
  };
}

function moved<L extends ImageLayer | MaskObjectLayer>(layer: L, { s, tx, ty }: Fit): L {
  return {
    ...layer,
    x: layer.x * s + tx,
    y: layer.y * s + ty,
    scaleX: layer.scaleX * s,
    scaleY: layer.scaleY * s,
  };
}

/** The image layer scaled to fit inside width x height, centred. */
export function fitImageLayer(layer: ImageLayer, width: number, height: number): ImageLayer {
  const fit = fitTransform(layer, width, height);
  return fit ? moved(layer, fit) : layer;
}

/** The frame with its first visible image scaled to fit inside width x height
 * and centred. Every other layer and mask stroke moves with it, so masks stay
 * on the pixels they were painted over. */
export function fitFrameContent(frame: InputFrame, width: number, height: number): InputFrame {
  const base = frame.layers.find((l): l is ImageLayer => l.type === "image" && l.visible);
  const fit = base && fitTransform(base, width, height);
  if (!fit) return frame;
  const { s, tx, ty } = fit;
  return {
    ...frame,
    layers: frame.layers.map((l) => (isPlaced(l) ? moved(l, fit) : l)),
    maskLines: frame.maskLines.map((line) => ({
      ...line,
      strokeWidth: line.strokeWidth * s,
      points: line.points.map((v, i) => v * s + (i % 2 === 0 ? tx : ty)),
    })),
  };
}
