import { describe, expect, it } from "vitest";
import type { WireSlot } from "@/canvas/inputFrames";
import { effectiveSizeMode } from "./sizeCompute";

const initialSlot: WireSlot = { frameId: "a", localIndex: 0, globalIndex: 1, mode: "initial" };
const referenceSlot = (index: number): WireSlot => ({
  frameId: "b",
  refId: `r${index}`,
  localIndex: index,
  globalIndex: index + 1,
  mode: "reference",
});

describe("effectiveSizeMode", () => {
  it("applies the size mode while Fit sizes the frame from an input image", () => {
    expect(effectiveSizeMode("megapixel", true, [initialSlot], true)).toBe("megapixel");
    expect(effectiveSizeMode("scale", true, [referenceSlot(0), referenceSlot(1)], true)).toBe(
      "scale",
    );
  });

  it("sends the frame size with Fit off or no input image", () => {
    expect(effectiveSizeMode("megapixel", false, [initialSlot], true)).toBe("fixed");
    expect(effectiveSizeMode("megapixel", true, [], true)).toBe("fixed");
  });

  it("leaves a lone local Reference to the server", () => {
    expect(effectiveSizeMode("megapixel", true, [referenceSlot(0)], true)).toBe("fixed");
    expect(effectiveSizeMode("megapixel", true, [referenceSlot(0)], false)).toBe("megapixel");
  });
});
