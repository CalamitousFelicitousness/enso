import { describe, expect, it } from "vitest";
import { exceedsLimit } from "./capacity";
import { frame, layer, picture } from "./frames.fixture";
import { addPicture, newFrame, setEnabled, updateFrame } from "./reducers";
import type { Frame } from "./types";

const SIZE = { width: 64, height: 64 };
const source = (id: string) => ({
  id,
  cid: id,
  file: new Blob([id]),
  name: id,
  width: 8,
  height: 8,
});

describe("exceedsLimit", () => {
  const one = [frame("man", "initial", layer("m"))];
  const two = [...one, frame("refs", "reference", picture("a"))];

  it("refuses a change that sends an image past the limit", () => {
    const more = updateFrame(two, "refs", (f) => addPicture(f, source("b"), SIZE));
    expect(exceedsLimit(two, more, 2)).toBe(true);
    expect(exceedsLimit(two, more, 3)).toBe(false);
    expect(exceedsLimit(two, more, null)).toBe(false);
  });

  it("lets a layer join an Initial frame that already sends", () => {
    const layered = updateFrame(two, "man", (f) => addPicture(f, source("top"), SIZE));
    expect(exceedsLimit(two, layered, 2)).toBe(false);
  });

  it("lets a list over the limit be edited as long as it adds nothing", () => {
    const over: Frame[] = [...two, frame("hat", "initial", layer("h"))];
    const off = updateFrame(over, "hat", (f) => setEnabled(f, false));
    expect(exceedsLimit(over, off, 1)).toBe(false);
    const empty = [...over, newFrame("new", "reference")];
    expect(exceedsLimit(over, empty, 1)).toBe(false);
    const back = updateFrame(off, "hat", (f) => setEnabled(f, true));
    expect(exceedsLimit(off, back, 1)).toBe(true);
  });
});

describe("a recalled set and the limit", () => {
  const two = [frame("man", "initial", layer("m")), frame("refs", "reference", picture("a"))];
  const recalled = [frame("r1", "reference", picture("x")), frame("r2", "reference", picture("y"))];

  it("joins when its frames are off, since they send nothing", () => {
    const off = recalled.map((f) => ({ ...f, enabled: false }));
    expect(exceedsLimit(two, [...two, ...off], 2)).toBe(false);
  });

  it("is refused when its frames would send past the limit", () => {
    expect(exceedsLimit(two, [...two, ...recalled], 2)).toBe(true);
    expect(exceedsLimit(two, [...two, ...recalled], 4)).toBe(false);
  });
});
