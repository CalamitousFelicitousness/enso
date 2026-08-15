import type { VideoModelCaps } from "@/api/types/video";

// Collapse a model's constraint rules into slider props. Anchoring min on
// the congruence class (min ≡ offset mod multiple) means ParamSlider's own
// stepping can only produce legal values.

function alignUp(value: number, multiple: number, offset: number): number {
  if (multiple <= 1) return value;
  return offset + multiple * Math.ceil((value - offset) / multiple);
}

function alignDown(value: number, multiple: number, offset: number): number {
  if (multiple <= 1) return value;
  return offset + multiple * Math.floor((value - offset) / multiple);
}

export function frameSliderProps(caps: VideoModelCaps): { min: number; max: number; step: number } {
  const r = caps.frame_rule;
  const min = alignUp(Math.max(1, r.min), r.multiple, r.offset);
  const max = Math.max(alignDown(r.max, r.multiple, r.offset), min);
  return { min, max, step: Math.max(1, r.multiple) };
}

export function canvasSliderProps(
  caps: VideoModelCaps,
  axis: "width" | "height",
): { min: number; max: number; step: number } {
  return {
    min: axis === "width" ? caps.min_width : caps.min_height,
    max: axis === "width" ? caps.max_width : caps.max_height,
    step: Math.max(1, caps.canvas_multiple),
  };
}

/** Snap a frame count into the model's legal domain (clamp, then align). */
export function alignFrames(value: number, caps: VideoModelCaps): number {
  const p = frameSliderProps(caps);
  const clamped = Math.min(Math.max(value, p.min), p.max);
  return Math.max(alignDown(clamped, p.step, p.min % Math.max(1, p.step)), p.min);
}

/** Snap a canvas dimension into the model's legal domain. */
export function alignCanvas(value: number, caps: VideoModelCaps, axis: "width" | "height"): number {
  const p = canvasSliderProps(caps, axis);
  const clamped = Math.min(Math.max(value, p.min), p.max);
  return Math.max(alignDown(clamped, p.step, 0), p.min);
}
