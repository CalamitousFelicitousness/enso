import { describe, expect, it } from "vitest";
import { frame, layer, picture } from "./frames.fixture";
import { computeOutline } from "./outline";
import { addressChanges } from "./renumber";
import { removeFrame, setEnabled, updateFrame } from "./reducers";
import { renumberText } from "./text";

describe("addressChanges", () => {
  const frames = [
    frame("man", "initial", layer("m")),
    frame("pets", "reference", picture("dog"), picture("cat")),
    frame("hat", "initial", layer("h")),
  ];
  const before = computeOutline(frames).sent;

  it("names every picture whose number moved, in the new order", () => {
    const after = computeOutline(removeFrame(frames, "man")).sent;
    const changes = addressChanges(before, after);
    expect(changes.map((c) => `${c.frameId}/${c.pictureId ?? "*"}:${c.from.n}>${c.to.n}`)).toEqual([
      "pets/dog:2>1",
      "pets/cat:3>2",
      "hat/*:4>3",
    ]);
    expect(renumberText(changes)).toBe(
      "Image 2 is now Image 1, Image 3 is now Image 2, Image 4 is now Image 3",
    );
  });

  it("says nothing when the numbers hold", () => {
    const after = computeOutline(updateFrame(frames, "hat", (f) => setEnabled(f, false))).sent;
    expect(addressChanges(before, after)).toEqual([]);
    expect(renumberText([])).toBeNull();
    expect(addressChanges(before, before)).toEqual([]);
  });
});
