import { describe, expect, it } from "vitest";
import { screenToWorld } from "./camera";
import { easeOutCubic, interpolateViewport, tweenDuration, tweenStep } from "./tween";

const container = { width: 800, height: 600 };
const centre = { x: 400, y: 300 };
const a = { x: 13.25, y: -7.5, scale: 0.37 };
const b = { x: -421.125, y: 88.0625, scale: 2.9 };

describe("interpolateViewport", () => {
  it("is exactly each end at 0 and 1", () => {
    expect(interpolateViewport(a, b, 0, container)).toBe(a);
    expect(interpolateViewport(a, b, 1, container)).toBe(b);
  });

  it("moves the scale in log space", () => {
    const mid = interpolateViewport(a, b, 0.5, container);
    expect(mid.scale).toBeCloseTo(Math.sqrt(a.scale * b.scale), 12);
  });

  it("moves the world point under the centre on a straight line", () => {
    const from = screenToWorld(a, centre);
    const to = screenToWorld(b, centre);
    for (const t of [0.1, 0.25, 0.5, 0.9]) {
      const at = screenToWorld(interpolateViewport(a, b, t, container), centre);
      expect(at.x).toBeCloseTo(from.x + (to.x - from.x) * t, 9);
      expect(at.y).toBeCloseTo(from.y + (to.y - from.y) * t, 9);
    }
  });
});

describe("tweenStep", () => {
  const tween = { from: a, start: 1000, duration: 200 };

  it("lands on the target it is given, bit for bit", () => {
    expect(tweenStep(tween, 1200, b, container)).toEqual({ vp: b, done: true });
    expect(tweenStep(tween, 5000, b, container).vp).toBe(b);
  });

  it("starts from where it began", () => {
    expect(tweenStep(tween, 1000, b, container)).toEqual({ vp: a, done: false });
  });

  it("follows a target that moves mid-tween", () => {
    const moved = { x: 5, y: 5, scale: 1 };
    const mid = tweenStep(tween, 1100, moved, container).vp;
    expect(mid).toEqual(interpolateViewport(a, moved, easeOutCubic(0.5), container));
    expect(tweenStep(tween, 1200, moved, container).vp).toBe(moved);
  });

  it("composes: a step from a pending target starts where that one is", () => {
    const pending = tweenStep(tween, 1050, b, container).vp;
    const next = { from: pending, start: 1050, duration: 120 };
    expect(tweenStep(next, 1050, b, container).vp).toBe(pending);
  });

  it("ends at once with no duration", () => {
    expect(tweenStep({ ...tween, duration: 0 }, 1000, b, container)).toEqual({ vp: b, done: true });
  });
});

describe("durations", () => {
  it("is quicker for keys than fits, and zero under reduced motion", () => {
    expect(tweenDuration("fit", false)).toBe(200);
    expect(tweenDuration("key", false)).toBeLessThan(tweenDuration("step", false));
    for (const kind of ["fit", "reveal", "step", "key"] as const) {
      expect(tweenDuration(kind, true)).toBe(0);
    }
  });

  it("eases out from 0 to 1", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});
