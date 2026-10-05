import { describe, expect, it } from "vitest";
import { frame, layer, maskObject, picture } from "./frames.fixture";
import { centredTransform, containTransform, refitFrame } from "./geometry";
import type { Frame, Transform } from "./types";

const at = (patch: Partial<Transform>): Transform => ({
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  ...patch,
});

const baseOf = (f: Frame) => f.pictures[0].transform!;

describe("refitFrame", () => {
  it("fits the first picture inside the frame, centred", () => {
    const f = frame("f", "initial", layer("a", { width: 1336, height: 744 }));
    const base = baseOf(refitFrame(f, { width: 1024, height: 1536 }));
    const s = 1024 / 1336;
    expect(base.scaleX).toBeCloseTo(s);
    expect(base.scaleY).toBeCloseTo(s);
    expect(base.x).toBeCloseTo(0);
    expect(base.y).toBeCloseTo((1536 - 744 * s) / 2);
  });

  it("keeps masks and other pictures on the pixels they covered", () => {
    const f: Frame = {
      ...frame(
        "f",
        "initial",
        layer("a", { width: 1336, height: 744 }),
        layer("b", { transform: at({ x: 300, y: 200 }) }),
      ),
      mask: {
        objects: [maskObject("m", { transform: at({ x: 100, y: 50 }) })],
        strokes: [{ points: [668, 372, 0, 0], strokeWidth: 20, tool: "brush" }],
      },
    };
    const out = refitFrame(f, { width: 1024, height: 1536 });
    const base = baseOf(out);
    const s = base.scaleX;
    const other = out.pictures[1].transform!;
    const mask = out.mask.objects[0].transform;
    // Positions in the base picture's own pixels are unchanged
    expect((other.x - base.x) / s).toBeCloseTo(300);
    expect((mask.x - base.x) / s).toBeCloseTo(100);
    expect((mask.y - base.y) / s).toBeCloseTo(50);
    expect(mask.scaleX).toBeCloseTo(s);
    const [cx, cy, ox, oy] = out.mask.strokes[0].points;
    expect(cx).toBeCloseTo(512);
    expect(cy).toBeCloseTo(768);
    expect(ox).toBeCloseTo(base.x);
    expect(oy).toBeCloseTo(base.y);
    expect(out.mask.strokes[0].strokeWidth).toBeCloseTo(20 * s);
  });

  it("returns the frame untouched when its content already fits", () => {
    const f = frame("f", "initial", layer("a", { width: 1336, height: 744 }));
    expect(refitFrame(f, { width: 1336, height: 744 })).toBe(f);
    // and fitting twice is fitting once
    const once = refitFrame(f, { width: 1024, height: 1536 });
    expect(refitFrame(once, { width: 1024, height: 1536 })).toBe(once);
  });

  it("fits a rotated picture by its rotated bounds", () => {
    // 200x100 turned 90 degrees about its origin at x=100 covers x 0..100, y 0..200
    const rotated = layer("a", {
      width: 200,
      height: 100,
      transform: at({ x: 100, rotation: 90 }),
    });
    const base = baseOf(refitFrame(frame("f", "initial", rotated), { width: 200, height: 400 }));
    expect(base.scaleX).toBeCloseTo(2);
    expect(base.rotation).toBe(90);
    expect(base.x).toBeCloseTo(200);
    expect(base.y).toBeCloseTo(0);
  });

  it("returns the frame untouched when it has no composition", () => {
    const hidden = frame("f", "initial", layer("a", { visible: false }));
    const slots = frame("g", "reference", picture("a"), picture("b"));
    expect(refitFrame(hidden, { width: 512, height: 512 })).toBe(hidden);
    expect(refitFrame(slots, { width: 512, height: 512 })).toBe(slots);
  });

  it("refits a composition a role switch has hidden", () => {
    const parked = layer("a", { width: 100, height: 100, visible: false, hiddenBySwitch: true });
    const f = frame("f", "reference", picture("r"), parked);
    const out = refitFrame(f, { width: 200, height: 200 });
    expect(out.pictures[0].transform).toBeNull();
    expect(out.pictures[1].transform!.scaleX).toBeCloseTo(2);
  });
});

describe("placing a new picture", () => {
  it("contains it in the frame, centred", () => {
    const t = containTransform({ width: 200, height: 100 }, { width: 100, height: 100 });
    expect(t).toEqual(at({ x: 0, y: 25, scaleX: 0.5, scaleY: 0.5 }));
  });

  it("centres it at natural size on whole pixels", () => {
    const t = centredTransform({ width: 101, height: 50 }, { width: 200, height: 100 });
    expect(t).toEqual(at({ x: 50, y: 25 }));
  });

  it("gives a picture with no area no scale", () => {
    expect(containTransform({ width: 0, height: 0 }, { width: 100, height: 100 })).toEqual(at({}));
  });
});
