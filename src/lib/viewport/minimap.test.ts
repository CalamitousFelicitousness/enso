import { describe, expect, it } from "vitest";
import { visibleWorld } from "./camera";
import type { ChromeBoxes, ChromeEntry } from "./insets";
import {
  MIN_RECT,
  MINIMAP_PADDING,
  MINIMAP_SIDE,
  dragView,
  drawnRect,
  minimapBounds,
  minimapProjection,
  minimapRoom,
  minimapSize,
  project,
  unproject,
  viewportRect,
} from "./minimap";
import type { Box } from "./types";

// A small PRNG, so a failure repeats
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const chrome = (entries: Record<string, ChromeEntry>): ChromeBoxes =>
  new Map(Object.entries(entries));

describe("minimapSize", () => {
  const pad = MINIMAP_PADDING * 2;

  it("keeps the bounds' aspect inside the square", () => {
    expect(minimapSize({ width: 2000, height: 1000 })).toEqual({
      width: MINIMAP_SIDE + pad,
      height: MINIMAP_SIDE / 2 + pad,
    });
    expect(minimapSize({ width: 600, height: 800 })).toEqual({
      width: MINIMAP_SIDE * 0.75 + pad,
      height: MINIMAP_SIDE + pad,
    });
  });

  it("holds a long strip at 1:2", () => {
    expect(minimapSize({ width: 5000, height: 500 })).toEqual({
      width: MINIMAP_SIDE + pad,
      height: MINIMAP_SIDE / 2 + pad,
    });
    expect(minimapSize({ width: 100, height: 5000 })).toEqual({
      width: MINIMAP_SIDE / 2 + pad,
      height: MINIMAP_SIDE + pad,
    });
  });

  it("is square for empty bounds", () => {
    expect(minimapSize({ width: 0, height: 0 })).toEqual({
      width: MINIMAP_SIDE + pad,
      height: MINIMAP_SIDE + pad,
    });
  });
});

describe("minimapProjection", () => {
  it("centres the bounds inside the padding", () => {
    const bounds = { x: -500, y: -200, width: 2000, height: 1000 };
    const box = minimapSize(bounds);
    const p = minimapProjection(bounds, box)!;
    expect(project(p, { x: -500, y: -200 })).toEqual({ x: MINIMAP_PADDING, y: MINIMAP_PADDING });
    const far = project(p, { x: 1500, y: 800 });
    expect(far.x).toBeCloseTo(box.width - MINIMAP_PADDING);
    expect(far.y).toBeCloseTo(box.height - MINIMAP_PADDING);
  });

  it("letterboxes bounds held to 1:2", () => {
    const bounds = { x: 0, y: 0, width: 5000, height: 500 };
    const box = minimapSize(bounds);
    const p = minimapProjection(bounds, box)!;
    const top = project(p, { x: 0, y: 0 });
    const bottom = project(p, { x: 0, y: 500 });
    expect(top.x).toBeCloseTo(MINIMAP_PADDING);
    expect((top.y + bottom.y) / 2).toBeCloseTo(box.height / 2);
  });

  it("round-trips any point", () => {
    const random = seeded(7);
    for (let i = 0; i < 200; i++) {
      const bounds = {
        x: (random() - 0.5) * 5000,
        y: (random() - 0.5) * 5000,
        width: 10 + random() * 8000,
        height: 10 + random() * 8000,
      };
      const p = minimapProjection(bounds, minimapSize(bounds))!;
      const world = { x: (random() - 0.5) * 9000, y: (random() - 0.5) * 9000 };
      const back = unproject(p, project(p, world));
      expect(back.x).toBeCloseTo(world.x, 6);
      expect(back.y).toBeCloseTo(world.y, 6);
    }
  });

  it("has nothing to project for empty bounds", () => {
    expect(
      minimapProjection({ x: 0, y: 0, width: 0, height: 10 }, { width: 100, height: 100 }),
    ).toBeNull();
  });
});

describe("viewportRect", () => {
  const container = { width: 1000, height: 600 };
  const bounds = { x: 0, y: 0, width: 4000, height: 2400 };
  const p = minimapProjection(bounds, minimapSize(bounds))!;

  it("is what the container shows, on the map", () => {
    const vp = { x: -500, y: -300, scale: 0.5 };
    const seen = visibleWorld(vp, container);
    const rect = viewportRect(vp, container, p);
    const corner = project(p, seen);
    expect(rect.x).toBeCloseTo(corner.x);
    expect(rect.y).toBeCloseTo(corner.y);
    expect(rect.width).toBeCloseTo(seen.width * p.scale);
    expect(rect.height).toBeCloseTo(seen.height * p.scale);
  });

  it("is never thinner than the minimum, about the same centre", () => {
    const vp = { x: -20000, y: -12000, scale: 32 };
    const rect = viewportRect(vp, container, p);
    expect(rect.width).toBe(MIN_RECT);
    expect(rect.height).toBe(MIN_RECT);
    const seen = visibleWorld(vp, container);
    const middle = project(p, { x: seen.x + seen.width / 2, y: seen.y + seen.height / 2 });
    expect(rect.x + rect.width / 2).toBeCloseTo(middle.x);
    expect(rect.y + rect.height / 2).toBeCloseTo(middle.y);
  });
});

describe("minimapBounds", () => {
  const content: Box = { x: 0, y: 0, width: 1000, height: 500 };

  it("is the content while the view's middle is on it, however much is seen", () => {
    expect(minimapBounds(content, { x: 100, y: 100, width: 200, height: 100 })).toEqual(content);
    expect(minimapBounds(content, { x: -2000, y: -2000, width: 5000, height: 4000 })).toEqual(
      content,
    );
  });

  it("stretches to the middle of a view panned off the content", () => {
    expect(minimapBounds(content, { x: 1400, y: -300, width: 400, height: 200 })).toEqual({
      x: 0,
      y: -200,
      width: 1600,
      height: 700,
    });
  });

  it("is what is seen with no content", () => {
    const seen = { x: 5, y: 5, width: 10, height: 10 };
    expect(minimapBounds(null, seen)).toEqual(seen);
  });

  it("puts part of the viewport's rectangle on the map", () => {
    const random = seeded(11);
    const container = { width: 1200, height: 800 };
    for (let i = 0; i < 200; i++) {
      const vp = {
        x: (random() - 0.5) * 20000,
        y: (random() - 0.5) * 20000,
        scale: 0.02 + random() * 4,
      };
      const bounds = minimapBounds(content, visibleWorld(vp, container));
      const box = minimapSize(bounds);
      const rect = viewportRect(vp, container, minimapProjection(bounds, box)!);
      const middle = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      expect(middle.x).toBeGreaterThanOrEqual(-1e-6);
      expect(middle.y).toBeGreaterThanOrEqual(-1e-6);
      expect(middle.x).toBeLessThanOrEqual(box.width + 1e-6);
      expect(middle.y).toBeLessThanOrEqual(box.height + 1e-6);
    }
  });
});

describe("drawnRect", () => {
  const box = { width: 172, height: 92 };

  it("keeps a rectangle inside the map as it is", () => {
    const rect = { x: 20, y: 10, width: 30, height: 20 };
    expect(drawnRect(rect, box, 0.5)).toEqual(rect);
  });

  it("outlines the map for a view larger than it", () => {
    expect(drawnRect({ x: -40, y: -30, width: 400, height: 300 }, box, 0.5)).toEqual({
      x: 0.5,
      y: 0.5,
      width: 171,
      height: 91,
    });
  });

  it("holds a rectangle past an edge at that edge, at least the minimum across", () => {
    const off = drawnRect({ x: 300, y: 20, width: 50, height: 30 }, box, 0.5);
    expect(off.x + off.width).toBe(171.5);
    expect(off.width).toBe(MIN_RECT);
    expect(off.y).toBe(20);
    expect(off.height).toBe(30);
  });
});

describe("dragView", () => {
  it("moves what is seen with the pointer, at the same zoom", () => {
    const container = { width: 1000, height: 600 };
    const bounds = { x: 0, y: 0, width: 4000, height: 2400 };
    const p = minimapProjection(bounds, minimapSize(bounds))!;
    const start = { x: -500, y: -300, scale: 0.5 };
    const moved = dragView(start, p, { x: 40, y: 30 }, { x: 50, y: 25 });
    expect(moved.scale).toBe(start.scale);
    const before = viewportRect(start, container, p);
    const after = viewportRect(moved, container, p);
    expect(after.x - before.x).toBeCloseTo(10);
    expect(after.y - before.y).toBeCloseTo(-5);
  });
});

describe("minimapRoom", () => {
  const toolbar = (width: number): ChromeEntry => ({
    kind: "screen",
    place: "bottom",
    width,
    height: 52,
    clear: true,
  });

  it("needs the map and a gap beside the widest bottom chrome", () => {
    // (1000 - 400) / 2 = 300 to the right of a 400 px toolbar
    expect(minimapRoom(1000, chrome({ toolbar: toolbar(400) }), 288)).toBe(true);
    expect(minimapRoom(1000, chrome({ toolbar: toolbar(400) }), 289)).toBe(false);
    const card: ChromeEntry = {
      kind: "screen",
      place: "bottom",
      width: 448,
      height: 70,
      clear: false,
    };
    expect(minimapRoom(1000, chrome({ toolbar: toolbar(400), card }), 288)).toBe(false);
  });

  it("has the whole width with nothing on the bottom edge", () => {
    expect(minimapRoom(400, new Map(), 188)).toBe(true);
    expect(minimapRoom(400, new Map(), 189)).toBe(false);
  });

  it("ignores its own corner and world chrome", () => {
    const corner: ChromeEntry = {
      kind: "screen",
      place: "corner",
      width: 200,
      height: 150,
      clear: true,
    };
    const dock: ChromeEntry = { kind: "world", box: { x: 0, y: 0, width: 5000, height: 40 } };
    expect(minimapRoom(400, chrome({ corner, dock }), 188)).toBe(true);
  });
});
