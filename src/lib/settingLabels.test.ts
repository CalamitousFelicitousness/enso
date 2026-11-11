import { describe, expect, it } from "vitest";
import { CARRIED_WITH, SETTING_LABELS, settingLabel, type SettingKey } from "./settingLabels";

describe("SETTING_LABELS", () => {
  it("names no two settings alike, apart from a key carried with another", () => {
    const carried = new Set(Object.values(CARRIED_WITH).flat());
    const seen = new Map<string, SettingKey>();
    for (const [key, label] of Object.entries(SETTING_LABELS) as [SettingKey, string][]) {
      if (carried.has(key)) continue;
      expect(seen.get(label), `${key} and ${seen.get(label)} are both "${label}"`).toBeUndefined();
      seen.set(label, key);
    }
  });

  it("falls back to the key for a setting it does not know", () => {
    expect(settingLabel("steps")).toBe("Steps");
    expect(settingLabel("somethingNew")).toBe("somethingNew");
  });
});
