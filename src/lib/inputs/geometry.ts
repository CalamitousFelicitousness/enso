import {
  isPlaced,
  type Frame,
  type MaskStroke,
  type Picture,
  type PlacedPicture,
  type Size,
  type Transform,
} from "./types";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Uniform scale s, then offset (tx, ty). */
interface Refit {
  s: number;
  tx: number;
  ty: number;
}

/** Axis-aligned bounds of natural-size content under a transform. */
export function placedBox(natural: Size, t: Transform): Box {
  const rad = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const w = natural.width * t.scaleX;
  const h = natural.height * t.scaleY;
  const xs = [0, w * cos, -h * sin, w * cos - h * sin];
  const ys = [0, w * sin, h * cos, w * sin + h * cos];
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: t.x + minX,
    y: t.y + minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

/** The refit that puts a placed picture inside the frame, centred; null for a
 * picture with no area. */
function containRefit(picture: PlacedPicture, frame: Size): Refit | null {
  const box = placedBox(picture, picture.transform);
  if (box.width <= 0 || box.height <= 0) return null;
  const s = Math.min(frame.width / box.width, frame.height / box.height);
  return {
    s,
    tx: (frame.width - box.width * s) / 2 - box.x * s,
    ty: (frame.height - box.height * s) / 2 - box.y * s,
  };
}

/** A refit that moves nothing: the content already fits. */
function isIdentity({ s, tx, ty }: Refit): boolean {
  return Math.abs(s - 1) < 1e-9 && Math.abs(tx) < 1e-6 && Math.abs(ty) < 1e-6;
}

function moved(t: Transform, { s, tx, ty }: Refit): Transform {
  return {
    ...t,
    x: t.x * s + tx,
    y: t.y * s + ty,
    scaleX: t.scaleX * s,
    scaleY: t.scaleY * s,
  };
}

function movedStroke(stroke: MaskStroke, { s, tx, ty }: Refit): MaskStroke {
  return {
    ...stroke,
    strokeWidth: stroke.strokeWidth * s,
    points: stroke.points.map((v, i) => v * s + (i % 2 === 0 ? tx : ty)),
  };
}

const UNPLACED: Transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };

/** Natural size, centred in the frame. */
export function centredTransform(natural: Size, frame: Size): Transform {
  return {
    ...UNPLACED,
    x: Math.round((frame.width - natural.width) / 2),
    y: Math.round((frame.height - natural.height) / 2),
  };
}

/** Scaled to fit inside the frame, centred. */
export function containTransform(natural: Size, frame: Size): Transform {
  if (natural.width <= 0 || natural.height <= 0) return UNPLACED;
  const s = Math.min(frame.width / natural.width, frame.height / natural.height);
  return {
    ...UNPLACED,
    x: (frame.width - natural.width * s) / 2,
    y: (frame.height - natural.height * s) / 2,
    scaleX: s,
    scaleY: s,
  };
}

/** A picture is part of the frame's composition when an Initial frame draws
 * it, or would once a role switch shows it again. */
function inComposition(picture: Picture): picture is PlacedPicture {
  return isPlaced(picture) && (picture.visible || picture.hiddenBySwitch);
}

/** The frame with the first picture of its composition scaled to fit inside
 * width x height and centred. Every other placed picture, mask object and
 * stroke moves with it, so masks stay on the pixels they were painted over. */
export function refitFrame(frame: Frame, size: Size): Frame {
  const base = frame.pictures.find(inComposition);
  const refit = base && containRefit(base, size);
  if (!refit || isIdentity(refit)) return frame;
  return {
    ...frame,
    pictures: frame.pictures.map((p) =>
      isPlaced(p) ? { ...p, transform: moved(p.transform, refit) } : p,
    ),
    mask: {
      objects: frame.mask.objects.map((m) => ({ ...m, transform: moved(m.transform, refit) })),
      strokes: frame.mask.strokes.map((line) => movedStroke(line, refit)),
    },
  };
}
