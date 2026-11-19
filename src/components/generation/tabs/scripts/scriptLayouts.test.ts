import { describe, expect, it } from "vitest";
import { resolveLayout } from "./scriptLayouts";

// Prompt enhance's settings as sdnext lists them since it added Min tokens at position 7
const ENHANCE = [
  "Prompt",
  "",
  "Auto enhance",
  "LLM model",
  "System prompt",
  "Prompt prefix",
  "Prompt suffix",
  "Min tokens",
  "Max tokens",
  "Use samplers",
  "Temperature",
  "Repetition penalty",
  "Top-K",
  "Top-P",
  "Thinking mode",
  "NSFW allowed",
  "Use vision",
  "Prefill text",
  "Keep Prefill",
  "Keep Thinking Trace",
  "Custom arguments",
  "Words to process",
  "Semantic threshold",
  "Embedding similarity",
  "OpenAI interface",
  "Prompt style",
];

describe("resolveLayout", () => {
  it("places settings by label, wherever sdnext lists them", () => {
    const layout = resolveLayout("prompt enhance", ENHANCE)!;
    expect(layout.headerRow).toEqual([2, 16]);
    expect(layout.enabledBy).toBe(2);
    expect(layout.headerArgRequires).toEqual({ 16: { arg: 3, includes: "\uf06e" } });
    const sampling = layout.groups.find((g) => g.title === "Sampling")!;
    expect(sampling.disabledUnless).toBe(9);
    expect(sampling.args).toEqual([9, 7, 8, 10, 11, 12, 13]);
    const options = layout.groups.find((g) => g.title === "Options")!;
    expect(options.argDisabledUnless).toEqual({ 18: 17, 19: 14 });
  });

  it("skips a label the script does not have", () => {
    const layout = resolveLayout(
      "prompt enhance",
      ENHANCE.filter((label) => label !== "Min tokens"),
    )!;
    const sampling = layout.groups.find((g) => g.title === "Sampling")!;
    expect(sampling.args).toEqual([8, 7, 9, 10, 11, 12]);
  });

  it("has no layout for a script it does not know", () => {
    expect(resolveLayout("story mode", ["Story mode enabled"])).toBeUndefined();
  });
});
