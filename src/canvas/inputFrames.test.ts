import { describe, expect, it } from "vitest";
import type { ImageLayer, ReferenceInput } from "@/stores/canvasStore";
import {
  controlUnitPosition,
  createInitialFrame,
  createReferenceFrame,
  enumerateWireSlots,
  framePosition,
  imageRangeLabel,
  parseSizeSourceValue,
  resolveSizeSource,
  sizeSourceRef,
  sizeSourceValue,
  sourceImageSize,
  toFrameShape,
  wireSources,
  type InputFrame,
  type SizeSourceRef,
} from "./inputFrames";

function layer(id: string, visible = true, width = 64, height = 64): ImageLayer {
  return {
    id,
    type: "image",
    visible,
    opacity: 1,
    locked: false,
    name: id,
    imageData: "",
    file: new File([], `${id}.png`),
    naturalWidth: width,
    naturalHeight: height,
    x: 0,
    y: 0,
    width,
    height,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  };
}

function reference(id: string, width = 64, height = 64): ReferenceInput {
  return {
    id,
    imageData: "",
    file: new File([], `${id}.png`),
    naturalWidth: width,
    naturalHeight: height,
    filename: `${id}.png`,
  };
}

function initial(...layers: ImageLayer[]): InputFrame {
  return { ...createInitialFrame(), layers };
}

function referenceFrame(...references: ReferenceInput[]): InputFrame {
  return { ...createReferenceFrame(), references };
}

const summary = (frames: InputFrame[]) =>
  wireSources(frames).map((s) =>
    s.kind === "initial"
      ? `${s.slot.globalIndex}:initial:${s.layers.map((l) => l.id).join("+")}`
      : `${s.slot.globalIndex}:reference:${s.reference.id}`,
  );

describe("wireSources", () => {
  it("follows frame order, then reference order within a frame", () => {
    const frames = [
      initial(layer("man")),
      referenceFrame(reference("dog"), reference("cat")),
      initial(layer("hat")),
    ];
    expect(summary(frames)).toEqual([
      "1:initial:man",
      "2:reference:dog",
      "3:reference:cat",
      "4:initial:hat",
    ]);
  });

  it("skips frames that send nothing without leaving a gap in the numbers", () => {
    const frames = [
      initial(),
      initial(layer("hidden", false)),
      referenceFrame(),
      referenceFrame(reference("dog")),
      initial(layer("man")),
    ];
    expect(summary(frames)).toEqual(["1:reference:dog", "2:initial:man"]);
  });

  it("sends an Initial frame's visible layers as one slot", () => {
    const frames = [initial(layer("base"), layer("off", false), layer("top"))];
    expect(summary(frames)).toEqual(["1:initial:base+top"]);
  });

  it("ignores the dormant arm of a frame", () => {
    const flipped: InputFrame = { ...referenceFrame(reference("dog")), layers: [layer("man")] };
    const flippedBack: InputFrame = { ...initial(layer("man")), references: [reference("dog")] };
    expect(summary([flipped])).toEqual(["1:reference:dog"]);
    expect(summary([flippedBack])).toEqual(["1:initial:man"]);
  });
});

describe("resolveSizeSource", () => {
  const man = initial(layer("man", true, 1336, 744));
  const refs = referenceFrame(reference("dog", 1024, 1536), reference("cat", 800, 600));

  const sized = (frames: InputFrame[], pick: SizeSourceRef | null) => {
    const source = resolveSizeSource(wireSources(frames), pick);
    if (!source) return null;
    const { width, height } = sourceImageSize(source);
    return `${source.slot.globalIndex}:${width}x${height}`;
  };

  it("defaults to Input 1", () => {
    expect(sized([man, refs], null)).toBe("1:1336x744");
    expect(sized([refs, man], null)).toBe("1:1024x1536");
  });

  it("keeps a picked image wherever it moves", () => {
    const cat = { frameId: refs.id, refId: "cat" };
    expect(sized([man, refs], cat)).toBe("3:800x600");
    expect(sized([refs, man], cat)).toBe("2:800x600");
    expect(sized([refs, man], { frameId: man.id, refId: null })).toBe("3:1336x744");
  });

  it("falls back to Input 1 once the picked image is gone", () => {
    expect(sized([man, refs], { frameId: refs.id, refId: "gone" })).toBe("1:1336x744");
    expect(sized([refs], { frameId: man.id, refId: null })).toBe("1:1024x1536");
  });

  it("follows a pick across its frame's mode switch", () => {
    const flipped: InputFrame = {
      ...man,
      mode: "reference",
      references: [reference("seed", 1336, 744)],
    };
    expect(sized([refs, flipped], { frameId: man.id, refId: null })).toBe("3:1336x744");
    const back: InputFrame = { ...refs, mode: "initial", layers: [layer("paint", true, 512, 512)] };
    expect(sized([man, back], { frameId: refs.id, refId: "cat" })).toBe("2:512x512");
  });

  it("names the source it resolved to", () => {
    const sources = wireSources([man, refs]);
    for (const source of sources) {
      const named = parseSizeSourceValue(sizeSourceValue(sizeSourceRef(source)));
      expect(resolveSizeSource(sources, named)).toBe(source);
    }
  });

  it("finds nothing without an input image", () => {
    expect(sized([initial(), referenceFrame()], null)).toBeNull();
  });
});

describe("input numbering", () => {
  const frames = [
    referenceFrame(reference("a"), reference("b"), reference("c")),
    initial(),
    initial(layer("x")),
  ];
  const slots = enumerateWireSlots(frames.map(toFrameShape));

  it("numbers frames by their place in the list, empty ones included", () => {
    expect(frames.map((f) => framePosition(frames, f.id))).toEqual([1, 2, 3]);
    expect(framePosition(frames, "missing")).toBeNull();
  });

  it("places control units after the frames", () => {
    expect(controlUnitPosition(frames.length, 0)).toBe(4);
    expect(controlUnitPosition(frames.length, 2)).toBe(6);
  });

  it("names the images a frame sends by the numbers a prompt uses", () => {
    expect(frames.map((f) => imageRangeLabel(slots, f.id))).toEqual(["Image 1-3", null, "Image 4"]);
  });
});
