import { describe, expect, it } from "vitest";
import { fitNote, type FitNoteInput } from "./fitNote";

const base: FitNoteInput = {
  mode: "fixed",
  setBy: { by: "fit", source: "Image 1" },
  size: { width: 3840, height: 3840 },
  native: { width: 1024, height: 1024 },
};

describe("fitNote", () => {
  it("names the size, its source and how far above the usual size it is", () => {
    expect(fitNote(base)).toEqual({
      text: "Fit set the size to 3840×3840 (14.7 MP) from Image 1, 14 times this model's usual 1024×1024. Larger sizes take longer, use more memory and can repeat the subject.",
      action: { kind: "megapixel", target: 1.048576, label: "Use Megapixel at 1.0 MP" },
    });
  });

  it("offers the switch to Initial when a lone Reference gives the size", () => {
    expect(fitNote({ ...base, setBy: { by: "reference", source: "Image 1" } })).toEqual({
      text: "This model generates at Image 1's size, 3840×3840 (14.7 MP), 14 times its usual 1024×1024. Larger sizes take longer, use more memory and can repeat the subject.",
      action: { kind: "toInitial" },
    });
  });

  it("stays away at four times the usual area or less", () => {
    expect(fitNote({ ...base, size: { width: 2048, height: 2048 } })).toBeNull();
    expect(fitNote({ ...base, size: { width: 2048, height: 2064 } })).not.toBeNull();
  });

  it("stays away under Scale or Megapixel, without a source, or without a usual size", () => {
    expect(fitNote({ ...base, mode: "megapixel" })).toBeNull();
    expect(fitNote({ ...base, mode: "scale" })).toBeNull();
    expect(fitNote({ ...base, setBy: null })).toBeNull();
    expect(fitNote({ ...base, native: null })).toBeNull();
  });
});
