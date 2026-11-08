import { describe, expect, it } from "vitest";
import {
  ctrlZoomFactor,
  normalizeWheel,
  wheelIntent,
  wheelZoomFactor,
  type WheelInput,
} from "./wheel";

const container = { width: 800, height: 600 };

function event(patch: Partial<WheelInput>): WheelInput {
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

describe("normalizeWheel", () => {
  it("keeps pixel deltas", () => {
    expect(normalizeWheel(event({ deltaX: 3, deltaY: -7 }), container)).toEqual({
      dx: 3,
      dy: -7,
      pinch: false,
      shift: false,
      pixels: true,
    });
  });

  it("turns lines into 16 px and pages into the container", () => {
    const lines = normalizeWheel(event({ deltaMode: 1, deltaY: 3 }), container);
    expect(lines.dy).toBe(48);
    expect(lines.pixels).toBe(false);
    const pages = normalizeWheel(event({ deltaMode: 2, deltaX: 1, deltaY: -1 }), container);
    expect(pages.dx).toBe(800);
    expect(pages.dy).toBe(-600);
  });

  it("takes Ctrl or Cmd as a pinch", () => {
    expect(normalizeWheel(event({ ctrlKey: true }), container).pinch).toBe(true);
    expect(normalizeWheel(event({ metaKey: true }), container).pinch).toBe(true);
  });
});

describe("zoom factors", () => {
  it("makes a 100 px notch one zoom step and clamps larger ones", () => {
    expect(wheelZoomFactor(100)).toBeCloseTo(Math.exp(-0.22), 12);
    expect(wheelZoomFactor(-100)).toBeCloseTo(Math.exp(0.22), 12);
    expect(wheelZoomFactor(500)).toBe(0.8);
    expect(wheelZoomFactor(-500)).toBe(1.25);
  });

  it("follows a trackpad pinch closely and a Ctrl notch by the step", () => {
    // Chrome on a Mac trackpad: a few px per event
    expect(ctrlZoomFactor(5, true)).toBeCloseTo(Math.exp(-0.05), 12);
    // A Windows precision touchpad sends 33 to 50 px events: about 10%
    expect(ctrlZoomFactor(33, true)).toBeCloseTo(Math.exp(-0.1), 12);
    expect(ctrlZoomFactor(50, true)).toBe(wheelZoomFactor(50));
    // A mouse notch with Ctrl in Chrome, and Firefox's 3-line notch
    expect(ctrlZoomFactor(100, true)).toBe(wheelZoomFactor(100));
    expect(ctrlZoomFactor(48, false)).toBeCloseTo(0.9, 2);
    expect(ctrlZoomFactor(-5, true)).toBeGreaterThan(1);
  });
});

describe("wheelIntent", () => {
  const n = (patch: Partial<WheelInput>) => normalizeWheel(event(patch), container);

  it("pans by the deltas under the Pan setting", () => {
    expect(wheelIntent(n({ deltaX: 10, deltaY: 20 }), "pan")).toEqual({
      kind: "pan",
      dx: -10,
      dy: -20,
    });
  });

  it("zooms with a plain wheel under the Zoom setting", () => {
    expect(wheelIntent(n({ deltaY: 100 }), "zoom")).toEqual({
      kind: "zoom",
      factor: wheelZoomFactor(100),
    });
  });

  it("pans sideways with Shift under either setting", () => {
    expect(wheelIntent(n({ deltaY: 30, shiftKey: true }), "pan")).toEqual({
      kind: "pan",
      dx: -30,
      dy: 0,
    });
    expect(wheelIntent(n({ deltaY: 30, shiftKey: true }), "zoom")).toEqual({
      kind: "pan",
      dx: -30,
      dy: 0,
    });
    // Chromium already moved the delta to x
    expect(wheelIntent(n({ deltaX: 30, shiftKey: true }), "zoom")).toEqual({
      kind: "pan",
      dx: -30,
      dy: 0,
    });
  });

  it("zooms on a pinch under either setting", () => {
    for (const mode of ["pan", "zoom"] as const) {
      expect(wheelIntent(n({ deltaY: -4, ctrlKey: true }), mode)).toEqual({
        kind: "zoom",
        factor: ctrlZoomFactor(-4, true),
      });
    }
  });

  it("does nothing for a zero delta", () => {
    expect(wheelIntent(n({}), "pan")).toBeNull();
    expect(wheelIntent(n({}), "zoom")).toBeNull();
    expect(wheelIntent(n({ ctrlKey: true }), "pan")).toBeNull();
    expect(wheelIntent(n({ shiftKey: true }), "pan")).toBeNull();
  });
});
