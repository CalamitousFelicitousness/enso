// What a consumer resamples a picture to, as SD.Next declares it, and the size
// the browser sends so that the consumer's own resize has nothing left to do.

import type { PixelSize } from "./dimensions";

export type SizeRule =
  /** sqrt(area * w/h), the height from the unrounded width, each side to the multiple (Qwen). */
  | { kind: "area"; area: number; multiple: number; round: "nearest" | "floor" | "ceil" }
  /** Above the area only, each side truncated after scaling (Flux2). */
  | { kind: "cap"; area: number }
  /** The size whose aspect is nearest, from sides floored to aspectMultiple; ties to the first listed. */
  | {
      kind: "buckets";
      sizes: PixelSize[];
      fit: "stretch" | "cover";
      ratio: "w/h" | "h/w";
      aspectMultiple: number;
    }
  /** The shortest side, the other truncated, the crop left to the consumer (CLIP). */
  | { kind: "shortest"; side: number }
  /** One size, stretched (SigLIP). */
  | { kind: "exact"; width: number; height: number }
  /** The longest side, the other rounded to the multiple (the cloud presets). */
  | { kind: "longest"; side: number; multiple: number }
  /** Each side floored to the multiple by a crop, any size. */
  | { kind: "floor"; multiple: number };

export interface SizeLimits {
  minSide?: number;
  maxAspect?: number;
}

/** A consumer's declaration; `rule: null` when it resamples to no fixed size. */
export interface DeclaredSize {
  rule: SizeRule | null;
  limits?: SizeLimits;
  outputArea?: number;
}

/** The size a picture goes out at; `cover` crops to its aspect first, centred. */
export interface Fit extends PixelSize {
  mode: "stretch" | "cover";
}

export type RuleRefusal = "tooSmall" | "tooWide";

/** Python's round(): a half goes to the even neighbour. */
export function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const rest = x - floor;
  if (rest !== 0.5) return rest < 0.5 ? floor : floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

const ROUND = { nearest: roundHalfEven, floor: Math.floor, ceil: Math.ceil };

function bucket(rule: Extract<SizeRule, { kind: "buckets" }>, size: PixelSize): PixelSize {
  const m = rule.aspectMultiple;
  const w = size.width - (size.width % m);
  const h = size.height - (size.height % m);
  const aspect = (s: PixelSize) => (rule.ratio === "w/h" ? s.width / s.height : s.height / s.width);
  const target = aspect({ width: w, height: h });
  let best = rule.sizes[0];
  let bestDiff = Infinity;
  for (const s of rule.sizes) {
    const diff = Math.abs(target - aspect(s));
    if (diff < bestDiff) {
      best = s;
      bestDiff = diff;
    }
  }
  return { width: best.width, height: best.height };
}

/** The size the consumer resamples a picture of `size` to, by its own arithmetic. */
export function ruleSize(rule: SizeRule, size: PixelSize): PixelSize {
  const { width: w, height: h } = size;
  switch (rule.kind) {
    case "area": {
      const ratio = w / h;
      const width = Math.sqrt(rule.area * ratio);
      const round = ROUND[rule.round];
      return {
        width: round(width / rule.multiple) * rule.multiple,
        height: round(width / ratio / rule.multiple) * rule.multiple,
      };
    }
    case "cap": {
      if (w * h <= rule.area) return { width: w, height: h };
      const scale = Math.sqrt(rule.area / (w * h));
      return { width: Math.trunc(w * scale), height: Math.trunc(h * scale) };
    }
    case "buckets":
      return bucket(rule, size);
    case "shortest": {
      const other = Math.trunc((rule.side * Math.max(w, h)) / Math.min(w, h));
      return w <= h ? { width: rule.side, height: other } : { width: other, height: rule.side };
    }
    case "exact":
      return { width: rule.width, height: rule.height };
    case "longest": {
      const longSide = Math.max(w, h);
      if (longSide <= rule.side) return { width: w, height: h };
      const long = Math.floor(rule.side / rule.multiple) * rule.multiple;
      const short = Math.max(
        rule.multiple,
        roundHalfEven((Math.min(w, h) * long) / longSide / rule.multiple) * rule.multiple,
      );
      return w >= h ? { width: long, height: short } : { width: short, height: long };
    }
    case "floor":
      return { width: w - (w % rule.multiple), height: h - (h % rule.multiple) };
  }
}

/**
 * The size to send a picture at, or null to send it whole: never enlarged
 * (the consumer enlarges as it would the original), never for a size the rule
 * keeps, and never under `floor`, whose crop needs no resample. `longest` is a
 * provider's hard limit and always applies.
 */
export function fitTo(rule: SizeRule, size: PixelSize): Fit | null {
  if (rule.kind === "floor") return null;
  const target = ruleSize(rule, size);
  if (target.width === size.width && target.height === size.height) return null;
  if (rule.kind !== "longest" && (target.width > size.width || target.height > size.height)) {
    return null;
  }
  return { ...target, mode: rule.kind === "buckets" ? rule.fit : "stretch" };
}

/** What the consumer refuses about a picture of the size that goes out. */
export function ruleRefusal(declared: DeclaredSize, size: PixelSize): RuleRefusal | null {
  const { minSide, maxAspect } = declared.limits ?? {};
  if (minSide !== undefined && Math.min(size.width, size.height) < minSide) return "tooSmall";
  if (
    maxAspect !== undefined &&
    Math.max(size.width / size.height, size.height / size.width) > maxAspect
  ) {
    return "tooWide";
  }
  return null;
}
