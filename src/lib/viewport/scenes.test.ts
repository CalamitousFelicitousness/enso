import { describe, expect, it } from "vitest";
import {
  CONTROL_COLOR,
  INPUT_COLOR_ACTIVE,
  INPUT_COLOR_INACTIVE,
  INPUT_COLOR_REFERENCE,
  OUTPUT_COLOR,
} from "@/lib/inputs/colors";
import { frame, layer, picture } from "@/lib/inputs/frames.fixture";
import { getOrderedFrames } from "@/lib/inputs/frames";
import { computeCanvasLayout } from "@/lib/inputs/layout";
import { computeOutline } from "@/lib/inputs/outline";
import { defaultControl } from "@/lib/inputs/reducers";
import type { Frame } from "@/lib/inputs/types";
import { imagesScene } from "./scenes";

const control = (id: string, ...pictures: Parameters<typeof frame>[2][]): Frame => ({
  ...frame(id, "control", ...pictures),
  control: { ...defaultControl(), model: "Xinsir" },
});

function scene(frames: Frame[], current: Parameters<typeof imagesScene>[3] = "output") {
  const entries = computeOutline(frames).entries;
  const layout = computeCanvasLayout({
    entries,
    frame: { width: 1024, height: 512 },
    output: { width: 1024, height: 512 },
    labelScale: 1,
    inputsAtCapacity: false,
  });
  return { layout, frames: imagesScene(layout, entries, frames, current) };
}

describe("imagesScene", () => {
  const frames = [
    frame("a", "initial", layer("p")),
    control("c", layer("e")),
    frame("r", "reference", picture("x")),
    frame("b", "initial"),
  ];

  it("lists every frame in step order, the Output last, with the layout's boxes", () => {
    const { layout, frames: drawn } = scene(frames);
    expect(drawn.map((f) => f.id)).toEqual(getOrderedFrames(layout).map((f) => f.id));
    const ordered = getOrderedFrames(layout);
    drawn.forEach((f, i) => {
      const { id: _id, ...box } = ordered[i];
      expect(f.box).toEqual(box);
    });
  });

  it("numbers each frame by its place in the list and names its role", () => {
    const { frames: drawn } = scene(frames);
    expect(drawn.map((f) => [f.short, f.name])).toEqual([
      ["1", "Input 1, Initial"],
      ["2", expect.stringMatching(/^Input 2, /)],
      ["3", "Input 3, Reference"],
      ["4", "Input 4, Initial"],
      ["Out", "Output"],
    ]);
    // A Control frame goes by its control type
    expect(drawn[1].name).not.toBe("Input 2, Control");
  });

  it("colours each frame as the canvas does", () => {
    const { frames: drawn } = scene(frames);
    expect(drawn.map((f) => f.color)).toEqual([
      INPUT_COLOR_ACTIVE,
      CONTROL_COLOR,
      INPUT_COLOR_REFERENCE,
      INPUT_COLOR_INACTIVE,
      OUTPUT_COLOR,
    ]);
  });

  it("marks a frame switched off", () => {
    const { frames: drawn } = scene([
      frame("a", "initial", layer("p")),
      { ...control("c", layer("e")), enabled: false },
    ]);
    expect(drawn.map((f) => f.off)).toEqual([false, true, false]);
  });

  it("marks the current frame, the Output included", () => {
    expect(
      scene(frames, "input:r")
        .frames.filter((f) => f.current)
        .map((f) => f.id),
    ).toEqual(["input:r"]);
    expect(
      scene(frames)
        .frames.filter((f) => f.current)
        .map((f) => f.id),
    ).toEqual(["output"]);
  });
});
