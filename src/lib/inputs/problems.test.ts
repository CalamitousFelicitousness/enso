import { describe, expect, it } from "vitest";
import { frame, layer, picture } from "./frames.fixture";
import { computeOutline } from "./outline";
import { fixProblem } from "./problems";
import { defaultControl } from "./reducers";
import type { ControlSettings, Frame, Picture } from "./types";

const unit = (id: string, type: ControlSettings["type"], ...pictures: Picture[]): Frame => ({
  ...frame(id, "control", ...pictures),
  control: { ...defaultControl(), model: "Xinsir", type },
});

/** Apply every fix the outline reports, each against the list it was computed from. */
function fixed(frames: Frame[], env = {}): Frame[] {
  const outline = computeOutline(frames, env);
  return outline.problems.reduce((list, problem) => fixProblem(list, problem), frames);
}

describe("fixProblem", () => {
  it("turns off the frames past the model's limit", () => {
    const frames = [
      frame("man", "initial", layer("m")),
      frame("pets", "reference", picture("dog"), picture("cat")),
      frame("hat", "initial", layer("h")),
    ];
    const after = fixed(frames, { maxInputImages: 2 });
    expect(after.map((f) => f.enabled)).toEqual([true, false, false]);
    expect(computeOutline(after, { maxInputImages: 2 }).problems).toEqual([]);
    expect(after[0]).toBe(frames[0]);
  });

  it("hides the set pictures past the limit", () => {
    const frames = [frame("refs", "reference", picture("a"), picture("b"), picture("c"))];
    const after = fixed(frames, { maxInputImages: 1 });
    expect(after[0].enabled).toBe(true);
    expect(after[0].pictures.map((p) => p.visible)).toEqual([true, false, false]);
    expect(computeOutline(after, { maxInputImages: 1 }).problems).toEqual([]);
  });

  it("keeps the first control type and turns the others off", () => {
    const frames = [
      unit("edges", "controlnet", layer("e")),
      unit("depth", "t2i", layer("d")),
      unit("pose", "controlnet", layer("p")),
    ];
    const after = fixed(frames);
    expect(after.map((f) => f.enabled)).toEqual([true, false, true]);
    expect(computeOutline(after).problems).toEqual([]);
  });

  it("drops what cannot be read and leaves the rest", () => {
    const frames = [
      frame("man", "initial", layer("m", { file: null }), layer("ok")),
      {
        ...unit("edges", "controlnet", layer("e")),
        processed: { cid: "p", blob: null, width: 1, height: 1 },
      },
    ];
    const after = fixed(frames);
    expect(after[0].pictures.map((p) => p.id)).toEqual(["ok"]);
    expect(after[1].processed).toBeNull();
    expect(computeOutline(after).problems).toEqual([]);
  });

  it("clears the mask beside a set and turns off the control frames", () => {
    const masked: Frame = {
      ...frame("man", "initial", layer("m")),
      mask: { objects: [], strokes: [{ points: [0, 0, 1, 1], strokeWidth: 4, tool: "brush" }] },
    };
    const frames = [
      masked,
      frame("refs", "reference", picture("a")),
      unit("edges", "controlnet", layer("e")),
    ];
    const after = fixed(frames);
    expect(after[0].mask).toEqual({ objects: [], strokes: [] });
    expect(after[2].enabled).toBe(false);
    expect(computeOutline(after).problems).toEqual([]);
  });
});
