import { describe, expect, it } from "vitest";
import {
  centerOn,
  clampScale,
  containsBox,
  fitBox,
  fitBoxBest,
  scaleRange,
  screenToWorld,
  unitScale,
  visibleWorld,
  worldToScreen,
  zoomAbout,
  zoomTo,
} from "./camera";
import type { Insets, Viewport } from "./types";

const NONE: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

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

describe("unit scale and range", () => {
  it("shows one generation pixel per CSS pixel at the unit scale", () => {
    // A 1024-tall frame is laid out 512 display units tall
    expect(unitScale(0.5)).toBe(2);
    expect(unitScale(1)).toBe(1);
    expect(scaleRange(2)).toEqual({ min: 0.04, max: 64 });
  });

  it("lets a scale outside the range move back but never further out", () => {
    const range = { min: 1, max: 4 };
    expect(clampScale(8, 2, range)).toBe(4);
    expect(clampScale(0.5, 0.25, range)).toBe(0.5);
    expect(clampScale(0.1, 0.25, range)).toBe(0.25);
    expect(clampScale(6, 5, range)).toBe(5);
  });
});

describe("zoom", () => {
  it("keeps the world point under the anchor", () => {
    const next = random(7);
    for (let i = 0; i < 200; i++) {
      const vp: Viewport = {
        x: next() * 800 - 400,
        y: next() * 800 - 400,
        scale: 0.1 + next() * 4,
      };
      const anchor = { x: next() * 1600, y: next() * 900 };
      const before = screenToWorld(vp, anchor);
      const after = zoomAbout(vp, anchor, 0.5 + next() * 1.5, { min: 0.01, max: 100 });
      const back = worldToScreen(after, before);
      expect(back.x).toBeCloseTo(anchor.x, 6);
      expect(back.y).toBeCloseTo(anchor.y, 6);
    }
  });

  it("keeps the anchor when the range clamps the step", () => {
    const vp: Viewport = { x: 10, y: 20, scale: 3.9 };
    const anchor = { x: 300, y: 200 };
    const before = screenToWorld(vp, anchor);
    const after = zoomAbout(vp, anchor, 2, { min: 0.5, max: 4 });
    expect(after.scale).toBe(4);
    expect(worldToScreen(after, before).x).toBeCloseTo(anchor.x, 9);
  });

  it("zooms to an exact scale", () => {
    expect(zoomTo({ x: 0, y: 0, scale: 1 }, { x: 100, y: 100 }, 2)).toEqual({
      x: -100,
      y: -100,
      scale: 2,
    });
  });
});

describe("what is on screen", () => {
  const vp: Viewport = { x: -100, y: 50, scale: 2 };
  const container = { width: 800, height: 600 };

  it("finds the visible part of the world", () => {
    expect(visibleWorld(vp, container)).toEqual({ x: 50, y: -25, width: 400, height: 300 });
  });

  it("knows a box wholly on screen from one that is cut", () => {
    expect(containsBox(vp, container, { x: 50, y: -25, width: 400, height: 300 })).toBe(true);
    expect(containsBox(vp, container, { x: 49, y: 0, width: 10, height: 10 })).toBe(false);
    expect(containsBox(vp, container, { x: 400, y: 0, width: 51, height: 10 })).toBe(false);
  });

  it("centres a world point at the same scale", () => {
    const centred = centerOn(vp, { x: 0, y: 0 }, container);
    expect(centred.scale).toBe(2);
    expect(worldToScreen(centred, { x: 0, y: 0 })).toEqual({ x: 400, y: 300 });
  });
});

describe("fitBox", () => {
  const container = { width: 1000, height: 600 };

  it("shows the box whole and centred inside the insets", () => {
    const box = { x: -200, y: -100, width: 1000, height: 400 };
    const insets = { top: 24, right: 24, bottom: 80, left: 24 };
    const vp = fitBox(box, container, insets, 10);
    expect(vp).not.toBeNull();
    if (!vp) return;
    const topLeft = worldToScreen(vp, { x: box.x, y: box.y });
    const bottomRight = worldToScreen(vp, { x: box.x + box.width, y: box.y + box.height });
    expect(topLeft.x).toBeGreaterThanOrEqual(24 - 1e-9);
    expect(topLeft.y).toBeGreaterThanOrEqual(24 - 1e-9);
    expect(bottomRight.x).toBeLessThanOrEqual(1000 - 24 + 1e-9);
    expect(bottomRight.y).toBeLessThanOrEqual(600 - 80 + 1e-9);
    // Width binds here, so the box spans the room across and is centred down
    expect(bottomRight.x - topLeft.x).toBeCloseTo(952, 9);
    expect(topLeft.y - 24).toBeCloseTo(600 - 80 - bottomRight.y, 9);
  });

  it("stops at the largest scale it may use", () => {
    const vp = fitBox({ x: 0, y: 0, width: 10, height: 10 }, container, NONE, 2);
    expect(vp?.scale).toBe(2);
    expect(vp && worldToScreen(vp, { x: 5, y: 5 })).toEqual({ x: 500, y: 300 });
  });

  it("may go below the zoom limits to show everything", () => {
    const vp = fitBox({ x: 0, y: 0, width: 1e6, height: 10 }, container, NONE, 2);
    expect(vp?.scale).toBeCloseTo(0.001, 12);
  });

  it("gives nothing for a box or a room without area", () => {
    expect(fitBox({ x: 0, y: 0, width: 0, height: 10 }, container, NONE, 2)).toBeNull();
    const crowded = { top: 400, right: 0, bottom: 300, left: 0 };
    expect(fitBox({ x: 0, y: 0, width: 10, height: 10 }, container, crowded, 2)).toBeNull();
    expect(
      fitBox({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 0 }, NONE, 2),
    ).toBeNull();
  });

  it("keeps the insets that leave the larger picture", () => {
    const box = { x: 0, y: 0, width: 1000, height: 300 };
    const bottom = { top: 0, right: 0, bottom: 200, left: 0 };
    const right = { top: 0, right: 200, bottom: 0, left: 0 };
    // Width binds, so giving up height costs nothing and giving up width does
    expect(fitBoxBest(box, container, [right, bottom], 10)?.scale).toBe(1);
    expect(fitBoxBest(box, container, [], 10)).toBeNull();
  });
});
