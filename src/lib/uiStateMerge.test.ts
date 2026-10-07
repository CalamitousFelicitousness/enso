import { describe, expect, it } from "vitest";
import { mergeUiState } from "./uiStateMerge";

const current = {
  activeImagesSubTab: "prompts",
  panelSelections: { modelsSubTab: "Current", settingsSection: null as string | null },
  uiScale: 18,
  quickSettingsKeys: ["a", "b"] as string[] | null,
};

describe("mergeUiState", () => {
  it("keeps a default for a key the stored record predates", () => {
    const merged = mergeUiState(
      { panelSelections: { modelsSubTab: "List" }, uiScale: 20 },
      current,
    );
    expect(merged.panelSelections).toEqual({ modelsSubTab: "List", settingsSection: null });
    expect(merged.uiScale).toBe(20);
  });

  it("replaces arrays rather than merging them", () => {
    expect(mergeUiState({ quickSettingsKeys: ["c"] }, current).quickSettingsKeys).toEqual(["c"]);
    expect(mergeUiState({ quickSettingsKeys: null }, current).quickSettingsKeys).toBeNull();
  });

  it("finds the Input tab under the name an older build stored", () => {
    expect(mergeUiState({ activeImagesSubTab: "control" }, current).activeImagesSubTab).toBe(
      "input",
    );
    expect(mergeUiState({ activeImagesSubTab: "color" }, current).activeImagesSubTab).toBe("color");
    expect(mergeUiState({}, current).activeImagesSubTab).toBe("prompts");
    expect(mergeUiState(undefined, current)).toEqual(current);
  });
});
