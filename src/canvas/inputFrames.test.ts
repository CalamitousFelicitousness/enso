import { describe, expect, it } from "vitest";
import type { ImageLayer, ReferenceInput } from "@/stores/canvasStore";
import {
  createInitialFrame,
  createReferenceFrame,
  wireSources,
  type InputFrame,
} from "./inputFrames";

function layer(id: string, visible = true): ImageLayer {
  return {
    id,
    type: "image",
    visible,
    opacity: 1,
    locked: false,
    name: id,
    imageData: "",
    file: new File([], `${id}.png`),
    naturalWidth: 64,
    naturalHeight: 64,
    x: 0,
    y: 0,
    width: 64,
    height: 64,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  };
}

function reference(id: string): ReferenceInput {
  return {
    id,
    imageData: "",
    file: new File([], `${id}.png`),
    naturalWidth: 64,
    naturalHeight: 64,
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
