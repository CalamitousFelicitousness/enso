import { describe, expect, it } from "vitest";
import {
  exportedText,
  importedText,
  importingText,
  modelLineText,
  modelLoadFailedText,
  networksMissingText,
  runsOnLoadedText,
  settingsLeftOutText,
  skippedSettingsText,
} from "./text";

describe("recipe words", () => {
  it("say a card's model line", () => {
    expect(modelLineText({ name: "Juggernaut XL v11", state: "missing" }, 0)).toBe(
      "Not found · Juggernaut XL v11",
    );
    expect(modelLineText({ name: "Juggernaut XL v11", state: "installed" }, 2)).toBe(
      "Installed · 2 LoRAs not found",
    );
    expect(modelLineText({ name: "Juggernaut XL v11", state: "installed" }, 0)).toBe(
      "Installed · Juggernaut XL v11",
    );
    expect(modelLineText(null, 1)).toBe("1 LoRA not found");
    expect(modelLineText(null, 0)).toBe("");
  });

  it("say export and import progress", () => {
    expect(exportedText("Portrait", 12, 48 * 1024 * 1024)).toBe(
      'Exported "Portrait" (12 pictures, about 48 MB)',
    );
    expect(exportedText("Portrait", 0, 2048)).toBe('Exported "Portrait" (no pictures, about 2 KB)');
    expect(importingText("portrait.enso", 12 * 1024 * 1024, 48 * 1024 * 1024)).toBe(
      'Importing "portrait.enso", about 12 MB of 48 MB',
    );
    expect(importedText(["Portrait"])).toBe('Imported "Portrait"');
    expect(importedText(["a", "b", "c"])).toBe("Imported 3 recipes");
  });

  it("say what was left out and skipped", () => {
    expect(settingsLeftOutText(["grading_lut_file"])).toBe(
      "Left out of the recipe: Color LUT (a file on the server)",
    );
    expect(skippedSettingsText(3)).toBe("3 settings this version does not know were skipped");
    expect(networksMissingText(1)).toBe("1 LoRA was not found");
    expect(runsOnLoadedText("Juggernaut XL v11", "unchecked")).toBe(
      "Juggernaut XL v11 is installed by name but was not checked; runs on the loaded model",
    );
    expect(modelLoadFailedText("Juggernaut XL v11", "API Error 400: busy")).toBe(
      "Could not load Juggernaut XL v11: API Error 400: busy",
    );
  });
});
