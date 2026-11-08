import { describe, expect, it } from "vitest";
import { screenToWorld, worldToScreen } from "./camera";
import { applyPinch, pinchStep, type PointerPair } from "./pinch";
import type { Viewport } from "./types";

const OPEN = { min: 1e-4, max: 1e4 };

/** A seeded generator, so a failure names the same numbers on every run. */
function random(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("pinch", () => {
  it("keeps the world point under the first midpoint under the last", () => {
    const next = random(11);
    for (let path = 0; path < 50; path++) {
      let vp: Viewport = { x: next() * 400 - 200, y: next() * 400 - 200, scale: 0.2 + next() * 3 };
      let pair: PointerPair = [
        { x: next() * 800, y: next() * 600 },
        { x: next() * 800, y: next() * 600 },
      ];
      const start = { x: (pair[0].x + pair[1].x) / 2, y: (pair[0].y + pair[1].y) / 2 };
      const anchor = screenToWorld(vp, start);
      for (let i = 0; i < 30; i++) {
        const moved: PointerPair = [
          { x: pair[0].x + next() * 20 - 10, y: pair[0].y + next() * 20 - 10 },
          { x: pair[1].x + next() * 20 - 10, y: pair[1].y + next() * 20 - 10 },
        ];
        vp = applyPinch(vp, pinchStep(pair, moved), OPEN);
        pair = moved;
      }
      const end = { x: (pair[0].x + pair[1].x) / 2, y: (pair[0].y + pair[1].y) / 2 };
      const landed = worldToScreen(vp, anchor);
      expect(landed.x).toBeCloseTo(end.x, 6);
      expect(landed.y).toBeCloseTo(end.y, 6);
    }
  });

  it("scales by the ratio of the finger distances", () => {
    const step = pinchStep(
      [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
      [
        { x: 50, y: 100 },
        { x: 250, y: 100 },
      ],
    );
    expect(step.factor).toBe(2);
    expect(applyPinch({ x: 0, y: 0, scale: 1.5 }, step, OPEN).scale).toBe(3);
  });

  it("leaves the camera alone for still fingers", () => {
    const pair: PointerPair = [
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ];
    const vp = { x: 5, y: 6, scale: 2 };
    expect(applyPinch(vp, pinchStep(pair, pair), OPEN)).toEqual(vp);
  });

  it("does not divide by zero for fingers on one spot", () => {
    const spot = { x: 10, y: 10 };
    const step = pinchStep([spot, spot], [spot, { x: 20, y: 10 }]);
    expect(step.factor).toBe(1);
    expect(Number.isFinite(applyPinch({ x: 0, y: 0, scale: 1 }, step, OPEN).scale)).toBe(true);
  });
});
