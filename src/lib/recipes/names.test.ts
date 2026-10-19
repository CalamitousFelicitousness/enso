import { describe, expect, it } from "vitest";
import { defaultRecipeName } from "./names";

const NOW = Date.UTC(2026, 9, 19, 14, 5);

describe("defaultRecipeName", () => {
  it("takes the prompt's opening words without network tags", () => {
    expect(defaultRecipeName("<lora:fur:1> a cat, sitting ", NOW, "UTC")).toBe("a cat, sitting");
  });

  it("cuts a long prompt at a word", () => {
    const name = defaultRecipeName(
      "a lighthouse on a cliff at dusk with waves crashing below it",
      NOW,
      "UTC",
    );
    expect(name).toBe("a lighthouse on a cliff at dusk with...");
  });

  it("names a recipe with no prompt by when it was saved", () => {
    expect(defaultRecipeName("  <lora:x>  ", NOW, "UTC")).toBe("Recipe 2026-10-19 14:05");
  });

  it("numbers a name the library holds", () => {
    expect(defaultRecipeName("a cat", NOW, "UTC", new Set(["a cat", "a cat (2)"]))).toBe(
      "a cat (3)",
    );
  });
});
