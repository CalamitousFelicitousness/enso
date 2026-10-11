import { describe, expect, it } from "vitest";
import { parseGenerationInfo } from "./parseGenerationInfo";

describe("parseGenerationInfo", () => {
  it("reads the job a stamp after the parameter line names, and leaves it out of the parameters", () => {
    const info = parseGenerationInfo(
      "a cat\nNegative prompt: blur\nSteps: 20, Seed: 7, Enso job: enso-0123abcd",
    );
    expect(info.jobId).toBe("0123abcd");
    expect(info.params).toEqual({ Steps: "20", Seed: "7" });
    expect(info.negativePrompt).toBe("blur");
  });

  it("takes the stamp off a negative prompt with no parameter line", () => {
    const info = parseGenerationInfo("a cat\nNegative prompt: blur, Enso job: enso-0123abcd");
    expect(info.jobId).toBe("0123abcd");
    expect(info.negativePrompt).toBe("blur");
  });

  it("finds no job in a prompt-only text, nor in a stamp pasted inside a prompt", () => {
    expect(parseGenerationInfo("just a prompt").jobId).toBeNull();
    const pasted = parseGenerationInfo("a cat, Enso job: enso-0123abcd\nSteps: 20");
    expect(pasted.jobId).toBeNull();
    expect(pasted.prompt).toBe("a cat, Enso job: enso-0123abcd");
  });

  it("is empty for no text", () => {
    expect(parseGenerationInfo(null)).toEqual({
      prompt: "",
      negativePrompt: "",
      params: {},
      jobId: null,
    });
  });
});
