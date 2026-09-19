import { describe, expect, it } from "vitest";
import { placedBounds } from "./geometry";

describe("placedBounds", () => {
  it("grows an axis-aligned layer by one pixel", () => {
    const b = placedBounds(
      { x: 10, y: 20, width: 30, height: 40, scaleX: 1, scaleY: 1, rotation: 0 },
      100,
      100,
    );
    expect(b).toEqual({ x: 9, y: 19, width: 32, height: 42 });
  });

  it("clamps to the frame", () => {
    const b = placedBounds(
      { x: -5, y: 90, width: 30, height: 40, scaleX: 1, scaleY: 1, rotation: 0 },
      100,
      100,
    );
    expect(b).toEqual({ x: 0, y: 89, width: 26, height: 11 });
  });

  it("returns null for a layer entirely outside the frame", () => {
    expect(
      placedBounds(
        { x: 200, y: 0, width: 10, height: 10, scaleX: 1, scaleY: 1, rotation: 0 },
        100,
        100,
      ),
    ).toBeNull();
  });

  it("covers a rotated layer's whole footprint", () => {
    // A 100x100 square rotated 45 degrees about its top-left corner spans
    // x in [-70.7, 70.7] and y in [0, 141.4]; the growth pixel is clamped
    // away on the two frame edges it touches.
    const b = placedBounds(
      { x: 0, y: 0, width: 100, height: 100, scaleX: 1, scaleY: 1, rotation: 45 },
      200,
      200,
    );
    expect(b).toEqual({ x: 0, y: 0, width: 72, height: 143 });
  });

  it("handles a negative scale (flipped layer)", () => {
    const b = placedBounds(
      { x: 50, y: 0, width: 30, height: 10, scaleX: -1, scaleY: 1, rotation: 0 },
      100,
      100,
    );
    expect(b).toEqual({ x: 19, y: 0, width: 32, height: 11 });
  });
});
