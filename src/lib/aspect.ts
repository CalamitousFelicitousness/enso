// Aspect-ratio lock math shared by the image and video size controls.
// Pure functions only; stateful behavior lives in useAspectLock.

export interface AspectPreset {
  label: string;
  w: number;
  h: number;
}

/** Legal domain of one size axis: [min, max] on multiples of `multiple`. */
export interface AxisRule {
  min: number;
  max: number;
  multiple: number;
}

export const DEFAULT_ASPECT_RATIOS =
  "1:1, 4:3, 3:2, 16:9, 16:10, 21:9, 2:3, 3:4, 9:16, 10:16, 9:21";

export function parseAspectRatios(raw: string): AspectPreset[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [w, h] = s.split(":").map(Number);
      return w > 0 && h > 0 ? { label: s, w, h } : null;
    })
    .filter((p): p is AspectPreset => p !== null);
}

/** Ratio encoded by a "W:H" label, or null for any other label shape. */
export function ratioFromLabel(label: string | null): number | null {
  if (!label) return null;
  const [w, h] = label.split(":").map(Number);
  return w > 0 && h > 0 ? w / h : null;
}

/** "16:9" -> "9:16". Labels without a ":" (cloud WxH presets) return null. */
export function flipRatioLabel(label: string): string | null {
  const parts = label.split(":");
  return parts.length === 2 ? `${parts[1]}:${parts[0]}` : null;
}

/** [min, max] of a rule, aligned inward to its multiple. */
export function axisBounds(rule: AxisRule): { min: number; max: number } {
  const m = Math.max(1, rule.multiple);
  const lo = Math.ceil(rule.min / m) * m;
  const hi = Math.max(Math.floor(rule.max / m) * m, lo);
  return { min: lo, max: hi };
}

/**
 * Driving-axis range that keeps the derived axis (driving / ratio) inside
 * `otherRule`. The lock is strict: instead of clamping the derived axis
 * after the fact, the driving control's range shrinks so an illegal pair
 * can never be requested. Null when no legal pair exists for this ratio.
 */
export function lockedAxisBounds(
  rule: AxisRule,
  otherRule: AxisRule,
  ratio: number,
): { min: number; max: number } | null {
  const m = Math.max(1, rule.multiple);
  const lo = Math.ceil(Math.max(rule.min, otherRule.min * ratio) / m) * m;
  const hi = Math.floor(Math.min(rule.max, otherRule.max * ratio) / m) * m;
  return lo <= hi ? { min: lo, max: hi } : null;
}

/** Round to the axis multiple, then clamp into the aligned [min, max]. */
export function snapAxis(value: number, rule: AxisRule): number {
  const m = Math.max(1, rule.multiple);
  const b = axisBounds(rule);
  return Math.min(b.max, Math.max(b.min, Math.round(value / m) * m));
}

/**
 * Width/height for a newly selected ratio preset, preserving the current
 * pixel area so switching presets does not change the generation cost.
 * Unfittable presets (empty locked range) leave the size unchanged.
 */
export function sizeForPreset(
  preset: AspectPreset,
  width: number,
  height: number,
  widthRule: AxisRule,
  heightRule: AxisRule,
): { w: number; h: number } {
  const ratio = preset.w / preset.h;
  const bounds = lockedAxisBounds(widthRule, heightRule, ratio);
  if (!bounds) return { w: width, h: height };
  const m = Math.max(1, widthRule.multiple);
  const ideal = Math.sqrt(width * height * ratio);
  const w = Math.min(bounds.max, Math.max(bounds.min, Math.round(ideal / m) * m));
  return { w, h: snapAxis(w / ratio, heightRule) };
}
