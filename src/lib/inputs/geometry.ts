import {
  isPlaced,
  type FitPolicy,
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

/** Scale (sx, sy) about the frame origin, then offset (tx, ty). */
interface Refit {
  sx: number;
  sy: number;
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

/** The refit that lays a placed box over the frame by policy, centred: contain
 * fits it inside, cover fills the frame and lets it overflow, fill stretches it
 * to the frame on both axes. Null for a box with no area. */
function policyRefit(box: Box, frame: Size, policy: FitPolicy): Refit | null {
  if (box.width <= 0 || box.height <= 0) return null;
  const wide = frame.width / box.width;
  const tall = frame.height / box.height;
  const [sx, sy] =
    policy === "fill"
      ? [wide, tall]
      : policy === "cover"
        ? [Math.max(wide, tall), Math.max(wide, tall)]
        : [Math.min(wide, tall), Math.min(wide, tall)];
  return {
    sx,
    sy,
    tx: (frame.width - box.width * sx) / 2 - box.x * sx,
    ty: (frame.height - box.height * sy) / 2 - box.y * sy,
  };
}

/** A refit that moves nothing: the content already fits. */
function isIdentity({ sx, sy, tx, ty }: Refit): boolean {
  return (
    Math.abs(sx - 1) < 1e-9 && Math.abs(sy - 1) < 1e-9 && Math.abs(tx) < 1e-6 && Math.abs(ty) < 1e-6
  );
}

function moved(t: Transform, { sx, sy, tx, ty }: Refit): Transform {
  return {
    ...t,
    x: t.x * sx + tx,
    y: t.y * sy + ty,
    scaleX: t.scaleX * sx,
    scaleY: t.scaleY * sy,
  };
}

function movedStroke(stroke: MaskStroke, { sx, sy, tx, ty }: Refit): MaskStroke {
  return {
    ...stroke,
    strokeWidth: stroke.strokeWidth * Math.min(sx, sy),
    points: stroke.points.map((v, i) => (i % 2 === 0 ? v * sx + tx : v * sy + ty)),
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

/** Natural-size content laid over the frame by policy, unrotated. */
export function fitTransform(natural: Size, frame: Size, policy: FitPolicy): Transform {
  const refit = policyRefit({ x: 0, y: 0, ...natural }, frame, policy);
  return refit ? moved(UNPLACED, refit) : UNPLACED;
}

/** Scaled to fit inside the frame, centred. */
export function containTransform(natural: Size, frame: Size): Transform {
  return fitTransform(natural, frame, "contain");
}

/** A picture is part of the frame's composition when a composed frame draws
 * it, or would once a role switch shows it again. */
function inComposition(picture: Picture): picture is PlacedPicture {
  return isPlaced(picture) && (picture.visible || picture.hiddenBySwitch);
}

/** The frame with the first picture of its composition laid over width x
 * height by the frame's fit policy (contain when it has none). Every other
 * placed picture, mask object and stroke moves with it, so masks stay on the
 * pixels they were painted over. */
export function refitFrame(frame: Frame, size: Size): Frame {
  const base = frame.pictures.find(inComposition);
  const refit = base && policyRefit(placedBox(base, base.transform), size, frame.fit ?? "contain");
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
