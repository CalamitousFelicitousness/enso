import { describe, expect, it } from "vitest";
import { frame, layer, picture } from "./frames.fixture";
import { computeCanvasLayout, frameBox, type LayoutInput } from "./layout";
import { computeOutline } from "./outline";
import { defaultControl, defaultIpAdapter } from "./reducers";
import type { Frame } from "./types";

const control = (id: string, ...pictures: Parameters<typeof frame>[2][]): Frame => ({
  ...frame(id, "control", ...pictures),
  control: { ...defaultControl(), model: "Xinsir" },
});

function input(frames: Frame[], patch: Partial<LayoutInput> = {}): LayoutInput {
  return {
    entries: computeOutline(frames).entries,
    frame: { width: 1024, height: 512 },
    output: { width: 1024, height: 512 },
    labelScale: 1,
    inputsAtCapacity: false,
    compositeProcessed: false,
    ...patch,
  };
}

/** Each frame as "role@x,y wxh". */
const places = (frames: Frame[], patch?: Partial<LayoutInput>) =>
  computeCanvasLayout(input(frames, patch)).frames.map((f) => {
    const box = frameBox(f);
    return `${f.role}@${box.x},${box.y} ${box.width}x${box.height}`;
  });

describe("computeCanvasLayout", () => {
  it("scales the frame to the reference height and places the output to its right", () => {
    const layout = computeCanvasLayout(input([frame("a", "initial", layer("p"))]));
    expect(layout.displayScale).toBe(1);
    expect(layout.displayW).toBe(1024);
    expect(layout.outputX).toBe(1024 + 48);
    expect(layout.totalBounds).toEqual({ minX: 0, maxX: 1024 + 48 + 1024, maxY: 512 });
    const tall = computeCanvasLayout(input([], { frame: { width: 512, height: 1024 } }));
    expect(tall.displayScale).toBe(0.5);
    expect(tall.displayW).toBe(256);
  });

  it("stacks image frames in the input column and control frames in a column to its left", () => {
    expect(
      places([
        frame("a", "initial", layer("p")),
        control("c", layer("e")),
        frame("r", "reference", picture("x")),
        {
          ...frame("i", "ipAdapter", picture("y")),
          ipAdapter: { ...defaultIpAdapter(), adapter: "Base SDXL" },
        },
        frame("b", "initial"),
      ]),
    ).toEqual([
      "initial@0,0 1024x512",
      "control@-1072,0 1024x512",
      "reference@0,576 1024x2028",
      "ipAdapter@-1072,576 1024x2028",
      "initial@0,2668 1024x512",
    ]);
  });

  it("lowers the control column by a processed map and shows the processed frame", () => {
    const mapped: Frame = {
      ...control("c", layer("e")),
      processed: { cid: "m", blob: new Blob(["m"]), width: 1, height: 1 },
    };
    const layout = computeCanvasLayout(input([mapped, control("d", layer("f"))]));
    const [first, second] = layout.frames;
    expect(first.kind === "composed" && first.processedY).toBe(512 + 16 + 30);
    expect(frameBox(second).y).toBe(512 + 16 + 30 + 512 + 64);
    expect(layout.showProcessedFrame).toBe(true);
    expect(layout.totalBounds.maxX).toBe(1024 + 48 + 1024 + 48 + 1024);
    // an off frame shows no map
    const off = computeCanvasLayout(input([{ ...mapped, enabled: false }]));
    expect(off.frames[0].kind === "composed" && off.frames[0].processedY).toBeNull();
    expect(off.showProcessedFrame).toBe(false);
  });

  it("keeps the add cell of an IP-Adapter frame when the input images are at capacity", () => {
    const layout = computeCanvasLayout(
      input([frame("r", "reference", picture("x")), frame("i", "ipAdapter", picture("y"))], {
        inputsAtCapacity: true,
      }),
    );
    const [refs, adapter] = layout.frames;
    expect(refs.kind === "set" && refs.addCellPosition).toBeNull();
    expect(adapter.kind === "set" && adapter.addCellPosition).not.toBeNull();
  });

  it("numbers Reference cells and leaves IP-Adapter cells unnumbered", () => {
    const layout = computeCanvasLayout(
      input([frame("r", "reference", picture("x")), frame("i", "ipAdapter", picture("y"))]),
    );
    const cells = layout.frames.map((f) =>
      f.kind === "set" ? f.children.map((c) => c.wireIndex) : [],
    );
    expect(cells).toEqual([[1], [null]]);
  });

  it("grows the stack gap with the label scale and reports the column bottoms", () => {
    const layout = computeCanvasLayout(
      input([frame("a", "initial"), frame("b", "initial"), control("c")], { labelScale: 2 }),
    );
    expect(frameBox(layout.frames[1]).y).toBe(512 + 16 + 64 + 16);
    expect(layout.inputColumnBottom).toBe(512 + 16 + 64 + 16 + 512);
    expect(layout.controlColumnBottom).toBe(512);
    expect(computeCanvasLayout(input([])).inputColumnBottom).toBe(0);
  });
});
