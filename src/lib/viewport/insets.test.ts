import { describe, expect, it } from "vitest";
import { fitBox, fitBoxBest } from "./camera";
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
        toolbar: { kind: "screen", place: "bottom", width: 400, height: 52, clear: true },
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
    // The picture alone leaves the dock out
    expect(targets.picture("input:a")).toEqual(input.box);
    expect(targets.picture("input:missing")).toBeNull();
  });

  it("takes a frame alone when its dock has not reported", () => {
    expect(fitTargets([input], new Map()).frame("input:a")).toEqual(input.box);
  });

  it("has nothing to show without frames or chrome", () => {
    expect(fitTargets([], new Map()).all).toBeNull();
  });
});

describe("screenInsets", () => {
  const margin = { top: FIT_MARGIN, right: FIT_MARGIN, bottom: FIT_MARGIN, left: FIT_MARGIN };
  const toolbar: ChromeEntry = {
    kind: "screen",
    place: "bottom",
    width: 400,
    height: 52,
    clear: true,
  };
  const minimap: ChromeEntry = {
    kind: "screen",
    place: "corner",
    width: 190,
    height: 120,
    clear: true,
  };

  it("keeps the margin on every side", () => {
    expect(screenInsets(new Map())).toEqual([margin]);
  });

  it("clears chrome pinned to the bottom edge", () => {
    expect(screenInsets(chrome({ toolbar }))).toEqual([{ ...margin, bottom: 64 }]);
  });

  it("clears chrome pinned to the top edge in every variant", () => {
    const controls: ChromeEntry = {
      kind: "screen",
      place: "top",
      width: 390,
      height: 40,
      clear: true,
    };
    expect(screenInsets(chrome({ controls }))).toEqual([{ ...margin, top: 52 }]);
    expect(screenInsets(chrome({ controls, toolbar, minimap })).map((i) => i.top)).toEqual([
      52, 52,
    ]);
  });

  it("ignores chrome it may cover", () => {
    const card: ChromeEntry = { ...toolbar, height: 90, clear: false };
    expect(screenInsets(chrome({ card }))).toEqual([margin]);
  });

  it("takes the corner off the bottom or off the right", () => {
    expect(screenInsets(chrome({ toolbar, minimap }))).toEqual([
      { ...margin, bottom: 132 },
      { ...margin, bottom: 64, right: 202 },
    ]);
  });

  it("keeps the deeper bottom when the toolbar reaches past the corner", () => {
    const tall = { ...toolbar, height: 150 };
    expect(screenInsets(chrome({ tall, minimap }))[0].bottom).toBe(162);
  });
});

describe("fitTargets with the minimap", () => {
  const minimap: ChromeEntry = {
    kind: "screen",
    place: "corner",
    width: 190,
    height: 120,
    clear: true,
  };

  it("fits all with whichever variant scales more", () => {
    const targets = fitTargets([input, output], chrome({ minimap }));
    expect(targets.insets).toHaveLength(2);
    // A wide row of frames in a tall container loses less to the bottom
    const tall = fitBoxBest(targets.all!, { width: 1100, height: 900 }, targets.insets, 2)!;
    const bottomOnly = fitBox(targets.all!, { width: 1100, height: 900 }, targets.insets[0], 2)!;
    expect(tall.scale).toBe(bottomOnly.scale);
    // and less to the right in a wide, short one
    const wide = fitBoxBest(targets.all!, { width: 2400, height: 600 }, targets.insets, 2)!;
    const rightOnly = fitBox(targets.all!, { width: 2400, height: 600 }, targets.insets[1], 2)!;
    expect(wide.scale).toBe(rightOnly.scale);
  });
});
