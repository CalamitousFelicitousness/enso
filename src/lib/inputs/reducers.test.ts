import { describe, expect, it } from "vitest";
import { frame, layer, maskObject, picture } from "./frames.fixture";
import {
  addIpMask,
  addPicture,
  applyBake,
  defaultControl,
  insertFrame,
  insertPicture,
  mergeContent,
  moveItem,
  movePicture,
  newFrame,
  patchTransform,
  removeFrame,
  removeIpMask,
  removeItem,
  setFit,
  setLink,
  setOnlyPicture,
  setPictureTransform,
  setPictureVisible,
  setProcessed,
  settleSelection,
  showHiddenBySwitch,
  switchRole,
  patchControl,
  patchIpAdapter,
  updateFrame,
} from "./reducers";
import type { Frame, PictureSource } from "./types";

const SIZE = { width: 1024, height: 1024 };

const source = (id: string, width = 64, height = 64): PictureSource => ({
  id,
  cid: `cid-${id}`,
  file: new Blob([id]),
  name: `${id}.png`,
  width,
  height,
});

/** Each picture as "id", "id(hidden)" or "id(switch)", with * when placed. */
const shape = (f: Frame) =>
  f.pictures.map((p) => {
    const state = p.hiddenBySwitch ? "(switch)" : p.visible ? "" : "(hidden)";
    return `${p.id}${p.transform ? "*" : ""}${state}`;
  });

describe("switchRole", () => {
  it("makes a Reference frame Initial with its first picture and hides the rest", () => {
    const f = frame("f", "reference", picture("a"), picture("b"), picture("c"));
    const out = switchRole(f, "initial", SIZE);
    expect(out.role).toBe("initial");
    expect(shape(out)).toEqual(["a*", "b(switch)", "c(switch)"]);
    expect(out.pictures[0].transform).toMatchObject({ scaleX: 16, x: 0, y: 0 });
  });

  it("gives every picture back on the switch back", () => {
    const f = frame("f", "reference", picture("a"), picture("b"), picture("c"));
    const back = switchRole(switchRole(f, "initial", SIZE), "reference", SIZE);
    expect(shape(back)).toEqual(["a*", "b", "c"]);
    expect(back.pictures.map((p) => p.visible)).toEqual([true, true, true]);
  });

  it("keeps a composition through Reference and back", () => {
    const moved = { x: 5, y: 6, scaleX: 2, scaleY: 2, rotation: 30 };
    const f = frame("f", "initial", layer("a"), layer("b", { transform: moved }));
    const back = switchRole(switchRole(f, "reference", SIZE), "initial", SIZE);
    expect(back).toEqual(f);
  });

  it("hides pictures added while Reference when the frame has a composition", () => {
    const f = frame("f", "reference", layer("a"), picture("new"));
    expect(shape(switchRole(f, "initial", SIZE))).toEqual(["a*", "new(switch)"]);
  });

  it("leaves a picture hidden by hand hidden", () => {
    const f = frame("f", "reference", picture("a", { visible: false }), picture("b"));
    expect(shape(switchRole(f, "initial", SIZE))).toEqual(["a(hidden)", "b*"]);
    const g = frame("g", "initial", layer("a", { visible: false }), layer("b"));
    expect(shape(switchRole(g, "reference", SIZE))).toEqual(["a*(hidden)", "b*"]);
  });

  it("returns the frame untouched for the role it has", () => {
    const f = frame("f", "initial", layer("a"));
    expect(switchRole(f, "initial", SIZE)).toBe(f);
  });
});

describe("showHiddenBySwitch", () => {
  it("places each hidden picture inside an Initial frame", () => {
    const f = switchRole(frame("f", "reference", picture("a"), picture("b")), "initial", SIZE);
    const out = showHiddenBySwitch(f, SIZE);
    expect(shape(out)).toEqual(["a*", "b*"]);
    // shown by hand, so the next round trip keeps both
    expect(shape(switchRole(switchRole(out, "reference", SIZE), "initial", SIZE))).toEqual([
      "a*",
      "b*",
    ]);
  });

  it("returns the frame untouched when nothing is hidden", () => {
    const f = frame("f", "initial", layer("a"));
    expect(showHiddenBySwitch(f, SIZE)).toBe(f);
  });
});

describe("addPicture", () => {
  it("fits an Initial frame's first picture and centres later ones at natural size", () => {
    const first = addPicture(newFrame("f", "initial"), source("a", 2048, 1024), SIZE);
    expect(first.pictures[0].transform).toEqual({
      x: 0,
      y: 256,
      scaleX: 0.5,
      scaleY: 0.5,
      rotation: 0,
    });
    const second = addPicture(first, source("b", 100, 100), SIZE);
    expect(second.pictures[1].transform).toEqual({
      x: 462,
      y: 462,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    });
  });

  it("leaves a Reference frame's picture unplaced", () => {
    const out = addPicture(newFrame("f", "reference"), source("a"), SIZE);
    expect(shape(out)).toEqual(["a"]);
  });

  it("fits the first picture placed after a switch hid unplaced ones", () => {
    const hidden = picture("r", { visible: false, hiddenBySwitch: true });
    const out = addPicture(frame("f", "initial", hidden), source("a", 2048, 2048), SIZE);
    expect(out.pictures[1].transform).toMatchObject({ scaleX: 0.5 });
  });
});

describe("setPictureVisible", () => {
  it("places a picture an Initial frame shows for the first time", () => {
    const f = frame("f", "initial", layer("a"), picture("b", { visible: false }));
    expect(shape(setPictureVisible(f, "b", true, SIZE))).toEqual(["a*", "b*"]);
  });

  it("turns a switch-hidden picture into one hidden by hand", () => {
    const f = frame("f", "initial", picture("b", { visible: false, hiddenBySwitch: true }));
    expect(shape(setPictureVisible(f, "b", false, SIZE))).toEqual(["b(hidden)"]);
  });

  it("returns the frame untouched when nothing changes", () => {
    const f = frame("f", "reference", picture("a"));
    expect(setPictureVisible(f, "a", true, SIZE)).toBe(f);
    expect(setPictureVisible(f, "gone", false, SIZE)).toBe(f);
  });
});

describe("picture edits", () => {
  it("moves only a picture that has a placement", () => {
    const f = frame("f", "reference", picture("a"));
    const t = { x: 1, y: 2, scaleX: 1, scaleY: 1, rotation: 0 };
    expect(setPictureTransform(f, "a", t)).toBe(f);
    const g = frame("g", "initial", layer("a"));
    expect(setPictureTransform(g, "a", t).pictures[0].transform).toEqual(t);
  });

  it("replaces a frame's pictures with one at the origin, keeping what a switch hid", () => {
    const parked = picture("ref", { visible: false, hiddenBySwitch: true });
    const f = frame("f", "initial", layer("a"), parked, layer("b"));
    const out = setOnlyPicture(f, source("restored", 1024, 1024));
    expect(shape(out)).toEqual(["restored*", "ref(switch)"]);
    expect(out.pictures[0].transform).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
  });

  it("moves a layer by part of its placement, picture or mask", () => {
    const f: Frame = {
      ...frame("f", "initial", layer("a"), picture("unplaced")),
      mask: { objects: [maskObject("m")], strokes: [] },
    };
    expect(patchTransform(f, "a", { x: 7 }).pictures[0].transform).toMatchObject({
      x: 7,
      scaleX: 1,
    });
    expect(patchTransform(f, "m", { rotation: 45 }).mask.objects[0].transform).toMatchObject({
      rotation: 45,
      x: 0,
    });
    expect(patchTransform(f, "unplaced", { x: 7 })).toBe(f);
    expect(patchTransform(f, "gone", { x: 7 })).toBe(f);
  });

  it("removes a layer, picture or mask", () => {
    const f: Frame = {
      ...frame("f", "initial", layer("a")),
      mask: { objects: [maskObject("m")], strokes: [] },
    };
    expect(removeItem(f, "a").pictures).toEqual([]);
    expect(removeItem(f, "m").mask.objects).toEqual([]);
    expect(removeItem(f, "gone")).toBe(f);
  });

  it("reorders pictures", () => {
    const f = frame("f", "reference", picture("a"), picture("b"), picture("c"));
    expect(shape(movePicture(f, 0, 2))).toEqual(["b", "c", "a"]);
    expect(movePicture(f, 1, 1)).toBe(f);
  });
});

describe("applyBake", () => {
  it("installs the baked objects and drops the strokes they consumed", () => {
    const stroke = (x: number) => ({
      points: [x, 0, x, 9],
      strokeWidth: 4,
      tool: "brush" as const,
    });
    const f: Frame = {
      ...frame("f", "initial", layer("a")),
      mask: { objects: [maskObject("old")], strokes: [stroke(1), stroke(2), stroke(3)] },
    };
    const out = applyBake(f, 2, [maskObject("new")]);
    expect(out.mask.objects.map((m) => m.id)).toEqual(["new"]);
    expect(out.mask.strokes).toEqual([stroke(3)]);
  });
});

describe("the frame list", () => {
  const frames = [newFrame("a", "initial"), newFrame("b", "reference"), newFrame("c", "initial")];
  const ids = (list: Frame[]) => list.map((f) => f.id);

  it("inserts at a place, clamped to the list", () => {
    const d = newFrame("d", "initial");
    expect(ids(insertFrame(frames, d))).toEqual(["a", "b", "c", "d"]);
    expect(ids(insertFrame(frames, d, 0))).toEqual(["d", "a", "b", "c"]);
    expect(ids(insertFrame(frames, d, 99))).toEqual(["a", "b", "c", "d"]);
    expect(ids(insertFrame(frames, d, -1))).toEqual(["d", "a", "b", "c"]);
  });

  it("keeps the same list for a change that changes nothing", () => {
    expect(removeFrame(frames, "gone")).toBe(frames);
    expect(updateFrame(frames, "gone", (f) => ({ ...f, enabled: false }))).toBe(frames);
    expect(updateFrame(frames, "a", (f) => f)).toBe(frames);
    expect(moveItem(frames, 0, 0)).toBe(frames);
    expect(moveItem(frames, 0, 3)).toBe(frames);
    expect(moveItem(frames, -1, 1)).toBe(frames);
  });

  it("leaves untouched frames as they were", () => {
    const next = updateFrame(frames, "b", (f) => ({ ...f, enabled: false }));
    expect(next[0]).toBe(frames[0]);
    expect(next[1]).not.toBe(frames[1]);
    expect(ids(moveItem(frames, 2, 0))).toEqual(["c", "a", "b"]);
  });
});

describe("settleSelection", () => {
  const a = frame("a", "initial", layer("x"));
  const b = frame("b", "reference", picture("y"));
  const c = frame("c", "initial", layer("z"));

  it("keeps a selection that still holds", () => {
    const selection = { selectedFrameId: "a", activeItem: { frameId: "a", id: "x" } };
    expect(settleSelection([a, b, c], [a, b, c], selection)).toEqual(selection);
  });

  it("keeps the active layer only in the selected frame", () => {
    const elsewhere = { selectedFrameId: "c", activeItem: { frameId: "a", id: "x" } };
    expect(settleSelection([a, b, c], [a, b, c], elsewhere).activeItem).toBeNull();
    const none = { selectedFrameId: null, activeItem: { frameId: "a", id: "x" } };
    expect(settleSelection([a, b, c], [a, b, c], none).activeItem).toBeNull();
  });

  it("hands a removed frame's selection to the frame before it", () => {
    const pick = (id: string, frames: Frame[]) =>
      settleSelection(frames, [a, b, c], { selectedFrameId: id, activeItem: null }).selectedFrameId;
    expect(pick("c", [a, b])).toBe("b");
    expect(pick("a", [b, c])).toBe("b");
    expect(pick("b", [a, c])).toBe("a");
    expect(pick("a", [])).toBeNull();
    expect(pick("unknown", [a, b])).toBe("a");
  });

  it("leaves no frame selected when none was", () => {
    const out = settleSelection([a], [a, b], { selectedFrameId: null, activeItem: null });
    expect(out.selectedFrameId).toBeNull();
  });

  it("drops an active layer that is gone or whose frame stopped composing", () => {
    const active = (item: { frameId: string; id: string }, frames: Frame[]) =>
      settleSelection(frames, [a, b, c], { selectedFrameId: item.frameId, activeItem: item })
        .activeItem;
    expect(active({ frameId: "a", id: "x" }, [b, c])).toBeNull();
    expect(active({ frameId: "a", id: "gone" }, [a])).toBeNull();
    expect(active({ frameId: "a", id: "x" }, [{ ...a, role: "reference" }])).toBeNull();
    expect(active({ frameId: "c", id: "z" }, [a, c])).toEqual({ frameId: "c", id: "z" });
  });
});

describe("control and IP-Adapter frames", () => {
  it("gives a new Control frame a contain fit and every role the same defaults", () => {
    expect(newFrame("c", "control").fit).toBe("contain");
    expect(newFrame("i", "initial").fit).toBeNull();
    expect(newFrame("r", "reference").control).toEqual(defaultControl());
    expect(newFrame("r", "reference").ipAdapter.masks).toEqual([]);
  });

  it("lays a Control frame's first picture over the frame by its fit", () => {
    const covered = addPicture(
      { ...newFrame("c", "control"), fit: "cover" },
      source("a", 64, 32),
      SIZE,
    );
    expect(covered.pictures[0].transform).toEqual({
      x: -512,
      y: 0,
      scaleX: 32,
      scaleY: 32,
      rotation: 0,
    });
    const filled = addPicture(
      { ...newFrame("c", "control"), fit: "fill" },
      source("a", 64, 32),
      SIZE,
    );
    expect(filled.pictures[0].transform).toEqual({
      x: 0,
      y: 0,
      scaleX: 16,
      scaleY: 32,
      rotation: 0,
    });
  });

  it("ends the fit when a picture is placed by hand", () => {
    const f = addPicture(newFrame("c", "control"), source("a"), SIZE);
    expect(f.fit).toBe("contain");
    const moved = setPictureTransform(f, "a", { ...f.pictures[0].transform!, x: 5 });
    expect(moved.fit).toBeNull();
    expect(patchTransform(f, "a", { rotation: 10 }).fit).toBeNull();
    // moving nothing changes nothing
    expect(setPictureTransform(f, "missing", f.pictures[0].transform!)).toBe(f);
  });

  it("lays the composition over the frame again when the fit changes", () => {
    const f = addPicture(newFrame("c", "control"), source("a", 64, 32), SIZE);
    const covered = setFit(f, "cover", SIZE);
    expect(covered.fit).toBe("cover");
    expect(covered.pictures[0].transform?.scaleX).toBe(32);
    expect(setFit(covered, null, SIZE).pictures[0].transform).toEqual(
      covered.pictures[0].transform,
    );
    expect(setFit(f, "contain", SIZE)).toBe(f);
  });

  it("keeps placements across a switch between composed roles", () => {
    const f = frame(
      "f",
      "initial",
      layer("a", { transform: { x: 10, y: 20, scaleX: 2, scaleY: 2, rotation: 0 } }),
    );
    const control = switchRole(f, "control", SIZE);
    expect(control.pictures).toEqual(f.pictures);
    expect(control.fit).toBe("contain");
    const back = switchRole(control, "initial", SIZE);
    expect(back.pictures).toEqual(f.pictures);
    expect(back.fit).toBeNull();
  });

  it("places a set frame's first picture when it becomes Control", () => {
    const control = switchRole(
      frame("f", "reference", picture("a"), picture("b")),
      "control",
      SIZE,
    );
    expect(shape(control)).toEqual(["a*", "b(switch)"]);
    expect(control.pictures[0].transform?.scaleX).toBe(16);
    expect(switchRole(control, "ipAdapter", SIZE).pictures.map((p) => p.visible)).toEqual([
      true,
      true,
    ]);
  });

  it("unlinks frames that took their picture from a removed frame", () => {
    const frames = [
      frame("a", "initial"),
      setLink(frame("c", "control"), "a"),
      setLink(frame("d", "control"), "other"),
    ];
    const left = removeFrame(frames, "a");
    expect(left.map((f) => f.link?.frameId ?? null)).toEqual([null, "other"]);
  });

  it("sets links, settings, region masks and the processed map", () => {
    const c = frame("c", "control");
    expect(setLink(c, "a").link).toEqual({ frameId: "a" });
    expect(setLink(c, null)).toBe(c);
    expect(patchControl(c, { model: "Xinsir", strength: 0.7 }).control).toMatchObject({
      model: "Xinsir",
      strength: 0.7,
      type: "controlnet",
    });
    const ip = frame("i", "ipAdapter");
    const masked = addIpMask(patchIpAdapter(ip, { adapter: "Base SDXL" }), source("m"));
    expect(masked.ipAdapter.adapter).toBe("Base SDXL");
    expect(masked.ipAdapter.masks.map((m) => m.id)).toEqual(["m"]);
    expect(removeIpMask(masked, "m").ipAdapter.masks).toEqual([]);
    expect(removeIpMask(masked, "none")).toBe(masked);
    const map = { cid: "map", blob: new Blob(["m"]), width: 8, height: 8 };
    expect(setProcessed(c, map).processed).toBe(map);
    expect(setProcessed(c, null)).toBe(c);
  });
});

describe("insertPicture and mergeContent", () => {
  it("puts a picture back at its place, clamped, once", () => {
    const f = frame("f", "reference", picture("a"), picture("c"));
    const b = picture("b");
    expect(insertPicture(f, b, 1).pictures.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(insertPicture(f, b, 9).pictures.map((p) => p.id)).toEqual(["a", "c", "b"]);
    expect(insertPicture(f, b, -1).pictures.map((p) => p.id)).toEqual(["b", "a", "c"]);
    expect(insertPicture(f, picture("a"), 0)).toBe(f);
  });

  it("gives back what a clear took out, beside what the frame holds now", () => {
    const was: Frame = {
      ...frame("f", "initial", layer("old")),
      mask: {
        objects: [maskObject("m")],
        strokes: [{ points: [0, 0, 1, 1], strokeWidth: 2, tool: "brush" }],
      },
      processed: { cid: "p", blob: new Blob(["p"]), width: 1, height: 1 },
    };
    const now: Frame = {
      ...frame("f", "initial", layer("new")),
      mask: { objects: [], strokes: [{ points: [2, 2, 3, 3], strokeWidth: 2, tool: "brush" }] },
    };
    const merged = mergeContent(now, was);
    expect(merged.pictures.map((p) => p.id)).toEqual(["new", "old"]);
    expect(merged.mask.objects.map((m) => m.id)).toEqual(["m"]);
    expect(merged.mask.strokes.map((s) => s.points[0])).toEqual([2, 0]);
    expect(merged.processed).toBe(was.processed);
    expect(mergeContent(merged, was).pictures.map((p) => p.id)).toEqual(["new", "old"]);
  });
});
