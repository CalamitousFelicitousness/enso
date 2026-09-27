import { describe, expect, it } from "vitest";
import type { ImageLayer, MaskObjectLayer } from "@/stores/canvasStore";
import { fitFrameContent } from "./frameFit";
import { createInitialFrame, type InputFrame } from "./inputFrames";

function image(width: number, height: number, placed: Partial<ImageLayer> = {}): ImageLayer {
  return {
    id: "image",
    type: "image",
    visible: true,
    opacity: 1,
    locked: false,
    name: "image",
    imageData: "",
    file: new File([], "image.png"),
    naturalWidth: width,
    naturalHeight: height,
    x: 0,
    y: 0,
    width,
    height,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    ...placed,
  };
}

function mask(x: number, y: number): MaskObjectLayer {
  return {
    id: "mask",
    type: "mask",
    visible: true,
    opacity: 1,
    locked: false,
    name: "mask",
    imageData: "",
    blob: new Blob(),
    x,
    y,
    width: 10,
    height: 10,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };
}

function frame(...layers: InputFrame["layers"]): InputFrame {
  return { ...createInitialFrame(), layers };
}

describe("fitFrameContent", () => {
  it("fits the first image inside the frame, centred", () => {
    const out = fitFrameContent(frame(image(1336, 744)), 1024, 1536);
    const base = out.layers[0] as ImageLayer;
    const s = 1024 / 1336;
    expect(base.scaleX).toBeCloseTo(s);
    expect(base.scaleY).toBeCloseTo(s);
    expect(base.x).toBeCloseTo(0);
    expect(base.y).toBeCloseTo((1536 - 744 * s) / 2);
  });

  it("keeps masks and other layers on the pixels they covered", () => {
    const f: InputFrame = {
      ...frame(image(1336, 744), mask(100, 50)),
      maskLines: [{ points: [668, 372, 0, 0], strokeWidth: 20, tool: "brush" }],
    };
    const out = fitFrameContent(f, 1024, 1536);
    const base = out.layers[0] as ImageLayer;
    const moved = out.layers[1] as MaskObjectLayer;
    const s = base.scaleX;
    // Positions in the image's own pixels are unchanged
    expect((moved.x - base.x) / s).toBeCloseTo(100);
    expect((moved.y - base.y) / s).toBeCloseTo(50);
    expect(moved.scaleX).toBeCloseTo(s);
    const [cx, cy, ox, oy] = out.maskLines[0].points;
    expect(cx).toBeCloseTo(512);
    expect(cy).toBeCloseTo(768);
    expect(ox).toBeCloseTo(base.x);
    expect(oy).toBeCloseTo(base.y);
    expect(out.maskLines[0].strokeWidth).toBeCloseTo(20 * s);
  });

  it("leaves an image that already fills its frame in place", () => {
    const base = fitFrameContent(frame(image(1336, 744)), 1336, 744).layers[0] as ImageLayer;
    expect(base.x).toBeCloseTo(0);
    expect(base.y).toBeCloseTo(0);
    expect(base.scaleX).toBeCloseTo(1);
  });

  it("fits a rotated image by its rotated bounds", () => {
    // 200x100 turned 90 degrees about its origin at x=100 covers x 0..100, y 0..200
    const rotated = image(200, 100, { x: 100, rotation: 90 });
    const base = fitFrameContent(frame(rotated), 200, 400).layers[0] as ImageLayer;
    expect(base.scaleX).toBeCloseTo(2);
    expect(base.rotation).toBe(90);
    expect(base.x).toBeCloseTo(200);
    expect(base.y).toBeCloseTo(0);
  });

  it("returns the frame untouched when no image is visible", () => {
    const f = frame(image(64, 64, { visible: false }));
    expect(fitFrameContent(f, 512, 512)).toBe(f);
  });
});
