import { describe, expect, it } from "vitest";
import { OUTPUT_PRESETS, repairCodecOptions } from "./videoOutputPresets";

describe("repairCodecOptions", () => {
  it("drops the faststart flag the Web Share preset stored", () => {
    expect(repairCodecOptions("crf=23,faststart")).toBe("crf=23");
    expect(repairCodecOptions("faststart")).toBe("");
  });

  it("rewrites the legacy spelling and keeps every other option", () => {
    expect(repairCodecOptions("crf:16,preset=slow")).toBe("crf=16,preset=slow");
  });

  it("leaves every preset's options as they are", () => {
    for (const preset of OUTPUT_PRESETS) {
      expect(repairCodecOptions(preset.codecOptions)).toBe(preset.codecOptions);
    }
  });
});
