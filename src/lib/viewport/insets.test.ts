import { describe, expect, it } from "vitest";
import {
  FIT_MARGIN,
  dockKey,
  fitTargets,
  screenInsets,
  unionBoxes,
  type ChromeBoxes,
  type ChromeEntry,
} from "./insets";

const chrome = (entries: Record<string, ChromeEntry>): ChromeBoxes =>
  new Map(Object.entries(entries));

const input = { id: "input:a", box: { x: 0, y: 0, width: 512, height: 512 } };
const output = { id: "output", box: { x: 560, y: 0, width: 512, height: 512 } };

describe("unionBoxes", () => {
  it("holds every box", () => {
    expect(
      unionBoxes([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: -5, y: 20, width: 10, height: 5 },
      ]),
    ).toEqual({ x: -5, y: 0, width: 15, height: 25 });
    expect(unionBoxes([])).toBeNull();
  });
});

describe("fitTargets", () => {
  it("shows every frame and every docked piece of chrome", () => {
    const targets = fitTargets(
      [input, output],
      chrome({
        [dockKey("input:a")]: { kind: "world", box: { x: -1, y: -60, width: 320, height: 45 } },
        [dockKey("output")]: { kind: "world", box: { x: 559, y: -300, width: 320, height: 285 } },
        "add:control": { kind: "world", box: { x: -560, y: 0, width: 512, height: 34 } },
        toolbar: { kind: "screen", edge: "bottom", extent: 52 },
      }),
    );
    expect(targets.all).toEqual({ x: -560, y: -300, width: 1632, height: 812 });
  });

  it("takes a frame with its own dock, as it is now", () => {
    const docked = chrome({
      [dockKey("input:a")]: { kind: "world", box: { x: -1, y: -60, width: 320, height: 45 } },
      [dockKey("output")]: { kind: "world", box: { x: 559, y: -300, width: 600, height: 285 } },
    });
    const targets = fitTargets([input, output], docked);
    expect(targets.frame("input:a")).toEqual({ x: -1, y: -60, width: 513, height: 572 });
    // A dock wider than its frame widens the target
    expect(targets.frame("output")).toEqual({ x: 559, y: -300, width: 600, height: 812 });
    expect(targets.frame("input:missing")).toBeNull();
  });

  it("takes a frame alone when its dock has not reported", () => {
    expect(fitTargets([input], new Map()).frame("input:a")).toEqual(input.box);
  });

  it("has nothing to show without frames or chrome", () => {
    expect(fitTargets([], new Map()).all).toBeNull();
  });
});

describe("screenInsets", () => {
  it("keeps the margin on every side", () => {
    expect(screenInsets(new Map())).toEqual({
      top: FIT_MARGIN,
      right: FIT_MARGIN,
      bottom: FIT_MARGIN,
      left: FIT_MARGIN,
    });
  });

  it("clears chrome pinned to the bottom edge", () => {
    const insets = screenInsets(
      chrome({ toolbar: { kind: "screen", edge: "bottom", extent: 52 } }),
    );
    expect(insets.bottom).toBe(64);
    expect(insets.top).toBe(FIT_MARGIN);
  });
});
