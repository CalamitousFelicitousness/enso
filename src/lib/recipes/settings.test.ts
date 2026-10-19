import { describe, expect, it } from "vitest";
import { settingsOf, snapshotSettings } from "./settings";

describe("snapshotSettings", () => {
  it("takes the keys the defaults know, without the dropped ones", () => {
    const gen = { steps: 30, prompt: "a", overrideSettings: { x: 1 }, seed: 7 };
    expect(snapshotSettings(gen, { steps: 20, prompt: "", overrideSettings: {} })).toEqual({
      steps: 30,
      prompt: "a",
    });
  });

  it("copies values, so a later change to the store does not reach the snapshot", () => {
    const gen = { styles: ["a"] };
    const snap = snapshotSettings(gen, { styles: [] });
    gen.styles.push("b");
    expect(snap).toEqual({ styles: ["a"] });
  });
});

describe("settingsOf", () => {
  it("takes what a job's settings set", () => {
    expect(settingsOf({ params: { steps: 12, seed: 5, overrideSettings: {} } })).toEqual({
      steps: 12,
      seed: 5,
    });
  });
});
