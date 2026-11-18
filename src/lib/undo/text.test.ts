import { describe, expect, it } from "vitest";
import {
  cancelTitle,
  clearsStepsText,
  failedText,
  nameText,
  oneSetting,
  placeOf,
  redoTitle,
  refusedText,
  stepText,
  stepsClearedText,
  undoTitle,
  undoneText,
  undoTourText,
  valueText,
  type Named,
} from "./text";
import type { Patch, Scope, StepName } from "./types";

const step = (name: StepName, patches: Patch[] = [], scope: Scope = "images"): Named => ({
  scope,
  name,
  patches,
  riders: [],
});

const keys = (slice: string, before: object, after: object): Patch => ({
  slice,
  kind: "keys",
  before: before as Record<string, unknown>,
  after: after as Record<string, unknown>,
});

describe("undo words", () => {
  it("names a set by its one setting, its values and a model by its last segment", () => {
    expect(stepText(step({ kind: "set" }, [keys("settings", { steps: 20 }, { steps: 30 })]))).toBe(
      "Steps 20 to 30",
    );
    const pick = keys("model", { activeModel: null }, { activeModel: { model_name: "sdxl/base" } });
    expect(stepText(step({ kind: "set" }, [pick], "shared"))).toBe("Model base picked");
    expect(
      stepText(
        step({ kind: "set" }, [keys("settings", { steps: 20, cfg: 7 }, { steps: 30, cfg: 5 })]),
      ),
    ).toBe("2 settings");
  });

  it("does not quote long or multi-line values", () => {
    expect(valueText(true)).toBe("on");
    expect(valueText(0.30000000000000004)).toBe("0.3");
    expect(valueText("x".repeat(33))).toBeNull();
    expect(valueText("a\nb")).toBeNull();
  });

  it("names typing by the field it changed, and a field inside a settings object", () => {
    const typing = { kind: "typing" };
    expect(stepText(step(typing, [keys("settings", { prompt: "a" }, { prompt: "ab" })]))).toBe(
      "Typing in Prompt",
    );
    const detailer = keys(
      "settings",
      { detailerDefaults: { prompt: "", strength: 0.5 } },
      { detailerDefaults: { prompt: "face", strength: 0.5 } },
    );
    expect(stepText(step(typing, [detailer]))).toBe("Typing in Detailer settings: prompt");
    // typed back to where it began: no change left, the name carries the field
    const named = { kind: "typing", args: { slice: "settings", key: "negativePrompt" } };
    expect(stepText(step(named))).toBe("Typing in Negative prompt");
    expect(stepText(step(typing))).toBe("Typing");
  });

  it("names an input edit by its position, and says an input when there is none", () => {
    expect(nameText({ kind: "stroke", args: { frame: "f", position: 2 } })).toBe(
      "Brush stroke on Input 2",
    );
    expect(nameText({ kind: "frame removed", args: { frame: "f" } })).toBe("An input removed");
  });

  it("names pictures added with and without the frame they went to", () => {
    expect(nameText({ kind: "add pictures", args: { count: 1, position: 3 } })).toBe(
      "Picture added to Input 3",
    );
    expect(nameText({ kind: "add pictures", args: { count: 4 } })).toBe("4 pictures added");
  });

  it("names the actions that name their own steps", () => {
    expect(nameText({ kind: "applied", args: { from: "PNG info" } })).toBe(
      "Settings applied from PNG info",
    );
    expect(nameText({ kind: "recall", args: { name: "Portrait", mode: "replace" } })).toBe(
      'Inputs replaced with "Portrait"',
    );
    expect(nameText({ kind: "recall", args: { name: "Portrait", mode: "add" } })).toBe(
      '"Portrait" added',
    );
    expect(nameText({ kind: "preset", args: { name: "Fast" } })).toBe('Preset "Fast" loaded');
    expect(nameText({ kind: "unknown" })).toBe("Change");
  });

  it("says where a step was made only when it is outside the view's own stack", () => {
    const stroke = step({ kind: "stroke", args: { position: 1 } });
    expect(undoTitle(stroke, "images", "Ctrl+Z")).toBe("Undo: Brush stroke on Input 1 (Ctrl+Z)");
    expect(undoTitle(stroke, "gallery", null)).toBe("Undo in Images: Brush stroke on Input 1");
    const trashed = step({ kind: "entry trashed", args: { name: "Set" } }, [], "shared");
    expect(placeOf(trashed)).toBe("Library");
    expect(redoTitle(trashed, "images", "Ctrl+Shift+Z")).toMatch(/^Redo in Library: /);
    expect(undoneText(trashed, "images")).toMatch(/^Undone in Library: /);
    expect(placeOf(step({ kind: "set" }, [], "shared"))).toBe("Top Bar");
  });

  it("words a cancel, a refusal and a failure", () => {
    expect(cancelTitle({ kind: "recall", args: { name: "Set", mode: "add" } }, "Ctrl+Z")).toBe(
      'Cancel: "Set" added (Ctrl+Z)',
    );
    const removed = step({ kind: "frame removed", args: { position: 2 } });
    expect(refusedText(removed, "undo")).toBe("Could not undo Input 2 removed");
    const trashed = step(
      { kind: "files trashed", args: { count: 2, name: "a.png" } },
      [],
      "gallery",
    );
    expect(failedText(trashed, "redo", true)).toMatch(/^Could not redo /);
    expect(failedText(removed, "undo", false)).toBe(
      "Undone here, but the server did not take it back: Input 2 removed",
    );
  });

  it("counts cleared steps, and says nothing for none", () => {
    expect(clearsStepsText(0)).toBeNull();
    expect(clearsStepsText(1)).toBe("This also clears 1 undo step.");
    expect(stepsClearedText(3)).toBe("3 undo steps cleared");
  });

  it("finds the one setting a step changed, for its Show button", () => {
    expect(oneSetting(step({ kind: "set" }, [keys("settings", { cfg: 7 }, { cfg: 5 })]))).toEqual({
      slice: "settings",
      key: "cfg",
    });
    expect(
      oneSetting(
        step({ kind: "set" }, [keys("settings", { cfg: 7, steps: 1 }, { cfg: 5, steps: 2 })]),
      ),
    ).toBeNull();
  });

  it("names the keys in the tour only when both are bound", () => {
    expect(undoTourText("Ctrl+Z", "Ctrl+Shift+Z")).toContain(
      "; Ctrl+Z and Ctrl+Shift+Z do the same.",
    );
    expect(undoTourText(null, "Ctrl+Shift+Z")).toMatch(/it is\.$/);
  });
});
