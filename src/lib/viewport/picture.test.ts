import { describe, expect, it } from "vitest";
import { FITTED, pictureScaleTo, pictureWheel, type PictureView } from "./picture";
import { ctrlZoomFactor, wheelZoomFactor, type WheelInput } from "./wheel";

const container = { width: 800, height: 600 };
const range = { min: 0.25, max: 8 };

/** Where a picture point (from its centre, unscaled) lands in the container. */
function onScreen(view: PictureView, p: { x: number; y: number }) {
  return {
    x: container.width / 2 + view.x + p.x * view.scale,
    y: container.height / 2 + view.y + p.y * view.scale,
  };
}

function wheel(patch: Partial<WheelInput>): WheelInput {
  return {
    deltaMode: 0,
    deltaX: 0,
    deltaY: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...patch,
  };
}

describe("pictureScaleTo", () => {
  it("keeps the point under the anchor in place", () => {
    const anchor = { x: 600, y: 150 };
    const start: PictureView = { scale: 2, x: -40, y: 30 };
    const p = { x: (anchor.x - 400 - start.x) / 2, y: (anchor.y - 300 - start.y) / 2 };
    const next = pictureScaleTo(start, anchor, container, 3, range);
    expect(next.scale).toBe(3);
    const at = onScreen(next, p);
    expect(at.x).toBeCloseTo(anchor.x);
    expect(at.y).toBeCloseTo(anchor.y);
  });

  it("recentres at or below the fitted size", () => {
    expect(
      pictureScaleTo({ scale: 2, x: 120, y: -80 }, { x: 10, y: 10 }, container, 0.9, range),
    ).toEqual({
      scale: 0.9,
      x: 0,
      y: 0,
    });
    expect(pictureScaleTo(FITTED, { x: 10, y: 10 }, container, 1, range)).toEqual(FITTED);
  });

  it("holds the scale inside the range", () => {
    expect(pictureScaleTo(FITTED, { x: 400, y: 300 }, container, 50, range).scale).toBe(8);
    expect(pictureScaleTo(FITTED, { x: 400, y: 300 }, container, 0.01, range).scale).toBe(0.25);
  });
});

describe("pictureWheel", () => {
  it("zooms a wheel notch about the pointer", () => {
    const next = pictureWheel(
      FITTED,
      wheel({ deltaY: -100 }),
      { x: 400, y: 300 },
      container,
      range,
    );
    expect(next?.scale).toBeCloseTo(wheelZoomFactor(-100));
    expect(next?.x).toBeCloseTo(0);
  });

  it("zooms a pinch by the pinch rate", () => {
    const next = pictureWheel(
      FITTED,
      wheel({ deltaY: -6, ctrlKey: true }),
      { x: 400, y: 300 },
      container,
      range,
    );
    expect(next?.scale).toBeCloseTo(ctrlZoomFactor(-6, true));
  });

  it("pans with Shift only when the picture is larger than fitted", () => {
    expect(
      pictureWheel(FITTED, wheel({ deltaY: 30, shiftKey: true }), { x: 0, y: 0 }, container, range),
    ).toBeNull();
    const zoomed: PictureView = { scale: 2, x: 0, y: 0 };
    expect(
      pictureWheel(zoomed, wheel({ deltaY: 30, shiftKey: true }), { x: 0, y: 0 }, container, range),
    ).toEqual({
      scale: 2,
      x: -30,
      y: 0,
    });
  });

  it("returns null when the scale is already at its limit", () => {
    const top: PictureView = { scale: 8, x: 0, y: 0 };
    expect(
      pictureWheel(top, wheel({ deltaY: -100 }), { x: 400, y: 300 }, container, range),
    ).toBeNull();
  });
});
