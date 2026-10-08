import { describe, expect, it } from "vitest";
import type { LegacyControlUnit } from "./legacyControl";
import { legacyResultSize, legacyResultToFrames } from "./legacyResult";

function ids(prefix: string) {
  let n = 0;
  return () => `${prefix}${++n}`;
}

const bytes = (width: number, height: number) => ({ blob: new Blob(["png"]), width, height });

function unit(patch: Partial<LegacyControlUnit> = {}): LegacyControlUnit {
  return {
    enabled: true,
    unitType: "controlnet",
    imageSource: "separate",
    processor: "None",
    model: "Union",
    mode: "canny",
    strength: 1,
    start: 0,
    end: 1,
    image: bytes(64, 64),
    processedImage: null,
    guess: false,
    factor: 1,
    attention: "Attention",
    fidelity: 0.5,
    queryWeight: 1,
    adainWeight: 1,
    adapter: "None",
    scale: 0.5,
    crop: false,
    images: [],
    masks: [],
    fitMode: "contain",
    freeTransform: null,
    processorParams: {},
    ...patch,
  };
}

describe("legacyResultToFrames", () => {
  const size = { width: 704, height: 1280 };

  it("keeps the picture at its own size, fitted inside the frame", () => {
    const [frame] = legacyResultToFrames(
      { image: bytes(352, 640), strokes: [], units: [], size },
      ids("id"),
      ids("cid"),
    );
    expect(frame.role).toBe("initial");
    const picture = frame.pictures[0];
    expect({ width: picture.width, height: picture.height }).toEqual({ width: 352, height: 640 });
    // drawn at twice its size, filling the frame
    expect(picture.transform).toEqual({ x: 0, y: 0, scaleX: 2, scaleY: 2, rotation: 0 });
  });

  it("keeps the strokes, also without a picture", () => {
    const strokes = [{ points: [1, 2, 3, 4], strokeWidth: 10, tool: "brush" as const }];
    const [frame] = legacyResultToFrames(
      { image: null, strokes, units: [], size },
      ids("id"),
      ids("cid"),
    );
    expect(frame.pictures).toEqual([]);
    expect(frame.mask).toEqual({ objects: [], strokes });
  });

  it("appends the control units, linked to the Initial frame where they took the canvas", () => {
    const frames = legacyResultToFrames(
      {
        image: bytes(704, 1280),
        strokes: [],
        units: [unit(), unit({ imageSource: "canvas", image: null, enabled: false })],
        size,
      },
      ids("id"),
      ids("cid"),
    );
    expect(frames.map((f) => f.role)).toEqual(["initial", "control", "control"]);
    expect(frames[2].link).toEqual({ frameId: frames[0].id });
  });

  it("makes no frames for a result that kept nothing", () => {
    expect(
      legacyResultToFrames({ image: null, strokes: [], units: [], size }, ids("id"), ids("cid")),
    ).toEqual([]);
  });
});

describe("legacyResultSize", () => {
  it("takes the generation size sent, else the older fields, else 1024", () => {
    expect(legacyResultSize({ width_before: 704, height_before: 1280, width: 512 })).toEqual({
      width: 704,
      height: 1280,
    });
    expect(legacyResultSize({ width: 512, height: 768 })).toEqual({ width: 512, height: 768 });
    expect(legacyResultSize({})).toEqual({ width: 1024, height: 1024 });
  });
});
