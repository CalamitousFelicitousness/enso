import { describe, expect, it } from "vitest";
import { legacyFingerprint, legacyToFrames } from "./legacy";
import { CANVAS_V3_RECORD, canvasV4Record } from "./legacyRecords.fixture";
import type { Frame } from "./types";

function cids() {
  let n = 0;
  return () => `cid-${++n}`;
}

const file = (name: string, bytes = name) => new File([bytes], name, { lastModified: 1 });

function imageLayer(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    type: "image",
    name: `${id}.png`,
    visible: true,
    opacity: 1,
    locked: false,
    file: file(`${id}.png`),
    naturalWidth: 640,
    naturalHeight: 480,
    x: 10,
    y: 20,
    width: 640,
    height: 480,
    rotation: 15,
    scaleX: 0.5,
    scaleY: 0.5,
    ...patch,
  };
}

function maskLayer(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    type: "mask",
    name: "Mask 3,4",
    visible: true,
    opacity: 1,
    locked: true,
    blob: new Blob([id]),
    x: 3,
    y: 4,
    width: 30,
    height: 40,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    ...patch,
  };
}

function reference(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    file: file(`${id}.png`),
    naturalWidth: 640,
    naturalHeight: 480,
    filename: `${id}.png`,
    ...patch,
  };
}

function legacyFrame(id: string, mode: string, patch: Record<string, unknown> = {}) {
  return { id, mode, layers: [], activeLayerId: null, maskLines: [], references: [], ...patch };
}

/** Each picture as "id", "id(hidden)" or "id(switch)", with * when placed. */
const shape = (f: Frame) =>
  f.pictures.map((p) => {
    const state = p.hiddenBySwitch ? "(switch)" : p.visible ? "" : "(hidden)";
    return `${p.id}${p.transform ? "*" : ""}${state}`;
  });

describe("legacyToFrames", () => {
  it("turns an Initial frame's layers, masks and strokes into one frame", () => {
    const line = { points: [1, 2, 3, 4], strokeWidth: 12, tool: "brush" };
    const a = imageLayer("a");
    const state = {
      inputFrames: [
        legacyFrame("f", "initial", {
          layers: [a, maskLayer("m"), imageLayer("b", { visible: false })],
          activeLayerId: "m",
          maskLines: [line],
        }),
      ],
      activeInputFrameId: "f",
    };
    const out = legacyToFrames(state, cids());
    const [f] = out.frames;
    expect(f).toMatchObject({ id: "f", role: "initial", enabled: true });
    expect(shape(f)).toEqual(["a*", "b*(hidden)"]);
    expect(f.pictures[0]).toMatchObject({
      name: "a.png",
      media: "image",
      width: 640,
      height: 480,
      transform: { x: 10, y: 20, scaleX: 0.5, scaleY: 0.5, rotation: 15 },
    });
    expect(f.pictures[0].file).toBe(a.file);
    expect(f.mask.objects).toMatchObject([
      { id: "m", name: "Mask 3,4", locked: true, width: 30, height: 40, transform: { x: 3, y: 4 } },
    ]);
    expect(f.mask.strokes).toEqual([line]);
    expect(out.selectedFrameId).toBe("f");
    expect(out.activeItem).toEqual({ frameId: "f", id: "m" });
    expect(out.notes).toEqual([]);
  });

  it("gives every imported Blob its own cid", () => {
    const state = {
      inputFrames: [
        legacyFrame("f", "initial", { layers: [imageLayer("a"), maskLayer("m")] }),
        legacyFrame("g", "reference", { references: [reference("r")] }),
      ],
    };
    const { frames } = legacyToFrames(state, cids());
    const all = frames.flatMap((f) => [...f.pictures, ...f.mask.objects]).map((x) => x.cid);
    expect(new Set(all).size).toBe(3);
  });

  it("keeps a Reference frame's pictures as unplaced slots in order", () => {
    const state = {
      inputFrames: [
        legacyFrame("g", "reference", { references: [reference("r1"), reference("r2")] }),
      ],
    };
    const [g] = legacyToFrames(state, cids()).frames;
    expect(g.role).toBe("reference");
    expect(shape(g)).toEqual(["r1", "r2"]);
  });

  it("keeps a picture a mode switch copied between the arms once", () => {
    const shared = file("man.png");
    const seeded = {
      inputFrames: [
        // Reference frame whose first reference was copied from its layer
        legacyFrame("g", "reference", {
          layers: [imageLayer("layer", { file: shared })],
          references: [reference("ref", { file: shared, filename: "man.png" }), reference("r2")],
        }),
        // Initial frame whose layer was copied from its reference
        legacyFrame("f", "initial", {
          layers: [imageLayer("layer2", { file: shared })],
          references: [reference("ref2", { file: shared, filename: "man.png" })],
        }),
      ],
      sizeSource: { frameId: "f", refId: "ref2" },
    };
    const out = legacyToFrames(seeded, cids());
    const [g, f] = out.frames;
    // the reference keeps its id and gains the layer's placement
    expect(shape(g)).toEqual(["ref*", "r2"]);
    expect(g.pictures[0].transform).toMatchObject({ x: 10, rotation: 15 });
    expect(shape(f)).toEqual(["layer2*"]);
    expect(out.sizeSource).toEqual({ frameId: "f", pictureId: "layer2" });
    expect(out.notes).toEqual([]);
  });

  it("keeps pictures found only in the other mode, hidden, and says so", () => {
    const state = {
      inputFrames: [
        legacyFrame("f", "initial", {
          layers: [imageLayer("a")],
          references: [reference("r1"), reference("r2")],
        }),
        legacyFrame("g", "reference", {
          layers: [imageLayer("b"), imageLayer("c", { visible: false })],
          references: [reference("r3")],
        }),
      ],
    };
    const out = legacyToFrames(state, cids());
    expect(shape(out.frames[0])).toEqual(["a*", "r1(switch)", "r2(switch)"]);
    expect(shape(out.frames[1])).toEqual(["r3", "b*(switch)", "c*(hidden)"]);
    expect(out.notes).toEqual([
      { kind: "otherMode", position: 1, count: 2 },
      { kind: "otherMode", position: 2, count: 2 },
    ]);
  });

  it("does not merge a hidden layer with the reference that shows", () => {
    const shared = file("man.png");
    const state = {
      inputFrames: [
        legacyFrame("g", "reference", {
          layers: [imageLayer("layer", { file: shared, visible: false })],
          references: [reference("ref", { file: shared })],
        }),
      ],
    };
    expect(shape(legacyToFrames(state, cids()).frames[0])).toEqual(["ref", "layer*(hidden)"]);
  });

  it("reads the base64 of a version 3 record", () => {
    const state = {
      inputFrames: [
        {
          id: "f",
          mode: "initial",
          layers: [
            imageLayer("a", { file: undefined, base64: btoa("pixels") }),
            maskLayer("m", { blob: undefined, base64: btoa("mask") }),
          ],
          references: [reference("r", { file: undefined, base64: btoa("ref") })],
        },
      ],
    };
    const [f] = legacyToFrames(state, cids()).frames;
    expect(f.pictures[0].file?.size).toBe(6);
    expect(f.mask.objects[0].blob.size).toBe(4);
    expect(f.pictures[1].file?.size).toBe(3);
    expect(f.mask.strokes).toEqual([]);
  });

  it("keeps a picture whose bytes are gone as unreadable and notes it", () => {
    const state = {
      inputFrames: [
        legacyFrame("f", "initial", {
          layers: [
            imageLayer("a", { file: null }),
            imageLayer("b", { file: undefined, base64: "not base64!" }),
            maskLayer("m", { blob: null }),
          ],
        }),
      ],
    };
    const out = legacyToFrames(state, cids());
    expect(out.frames[0].pictures.map((p) => p.file)).toEqual([null, null]);
    expect(out.frames[0].mask.objects).toEqual([]);
    expect(out.notes).toEqual([
      { kind: "unreadablePicture", position: 1, name: "a.png" },
      { kind: "unreadablePicture", position: 1, name: "b.png" },
      { kind: "unreadableMask", position: 1, count: 1 },
    ]);
  });

  it("converts what it can of a malformed record and counts the rest", () => {
    const state = {
      inputFrames: [
        "not a frame",
        { mode: "initial" },
        legacyFrame("f", "initial", {
          layers: [imageLayer("a"), { type: "drawing", id: "d" }, null, { type: "image" }],
          maskLines: [{ points: [1, "2"], strokeWidth: 1, tool: "brush" }],
          references: "none",
        }),
      ],
      activeInputFrameId: "gone",
      sizeSource: { frameId: "gone", refId: null },
    };
    const out = legacyToFrames(state, cids());
    expect(out.frames.map((f) => f.id)).toEqual(["f"]);
    expect(shape(out.frames[0])).toEqual(["a*"]);
    expect(out.notes).toEqual([{ kind: "skipped", position: 1, count: 4 }]);
    expect(out.selectedFrameId).toBe("f");
    expect(out.activeItem).toBeNull();
    expect(out.sizeSource).toBeNull();
  });

  it.each([undefined, null, "text", {}, { inputFrames: null }])(
    "imports nothing from %j",
    (state) => {
      expect(legacyToFrames(state, cids())).toEqual({
        frames: [],
        selectedFrameId: null,
        activeItem: null,
        sizeSource: null,
        notes: [],
      });
    },
  );
});

describe("legacyFingerprint", () => {
  const state = (layers: unknown[], maskLines: unknown[] = []) => ({
    viewport: { x: 0, y: 0, scale: 1 },
    inputFrames: [legacyFrame("f", "initial", { layers, maskLines })],
  });

  it("ignores where things are and how the canvas is viewed", () => {
    const before = state([imageLayer("a")]);
    const after = {
      ...state([imageLayer("a", { x: 400, scaleX: 2, visible: false })]),
      viewport: { x: 9, y: 9, scale: 3 },
    };
    expect(legacyFingerprint(after)).toBe(legacyFingerprint(before));
  });

  it("changes when content is added, removed or replaced", () => {
    const base = legacyFingerprint(state([imageLayer("a")]));
    const variants = [
      state([imageLayer("a"), imageLayer("b")]),
      state([]),
      state([imageLayer("replaced")]),
      state([imageLayer("a")], [{ points: [0, 0, 1, 1], strokeWidth: 1, tool: "brush" }]),
      { inputFrames: [legacyFrame("f", "reference", { layers: [imageLayer("a")] })] },
    ];
    for (const variant of variants) expect(legacyFingerprint(variant)).not.toBe(base);
  });

  it("is the same for a record whose handles can no longer be read", () => {
    const live = state([imageLayer("a")]);
    // what a dead handle is replaced with before an import
    const dead = state([imageLayer("a", { file: { size: 5 } })]);
    expect(legacyFingerprint(dead)).toBe(legacyFingerprint(live));
    expect(legacyToFrames(dead, cids()).frames[0].pictures[0].file).toBeNull();
  });

  it("is the same for a record rewritten in another format", () => {
    const handles = state([imageLayer("a"), maskLayer("m")]);
    const base64 = state([
      imageLayer("a", { file: undefined, base64: btoa("pixels") }),
      maskLayer("m", { blob: undefined, base64: btoa("mask") }),
    ]);
    expect(legacyFingerprint(base64)).toBe(legacyFingerprint(handles));
  });

  it("reads anything without throwing", () => {
    for (const value of [undefined, null, 3, { inputFrames: [null, "x", {}] }]) {
      expect(legacyFingerprint(value)).toMatch(/^[0-9a-f]{8}$/);
    }
  });
});

describe("records dumped from a browser profile", () => {
  it("imports the version 4 record as one placed picture", () => {
    const out = legacyToFrames(canvasV4Record().state, cids());
    expect(out.frames).toHaveLength(1);
    const [f] = out.frames;
    expect(f.role).toBe("initial");
    // the reference copied from the layer is the same picture
    expect(shape(f)).toEqual(["b0bd3c43-05d3-4554-b733-41380b97eea5*"]);
    expect(f.pictures[0]).toMatchObject({
      name: "ref-1024.png",
      width: 1024,
      height: 1024,
      transform: { x: 0, y: 416, scaleX: 1.0625, scaleY: 1.0625, rotation: 0 },
    });
    expect(f.pictures[0].file?.size).toBe(1510360);
    expect(out.selectedFrameId).toBe(f.id);
    expect(out.sizeSource).toBeNull();
    expect(out.notes).toEqual([]);
  });

  it("imports the version 3 record, keeping the layer its Reference frame left behind", async () => {
    const { state } = JSON.parse(CANVAS_V3_RECORD) as { state: unknown };
    const out = legacyToFrames(state, cids());
    const [f] = out.frames;
    expect(f.role).toBe("reference");
    expect(shape(f)).toEqual(["orphan-layer-test*(switch)"]);
    expect(f.pictures[0]).toMatchObject({ name: "leftover.png", width: 99, height: 151 });
    const bytes = new Uint8Array(await f.pictures[0].file!.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(1, 4))).toBe("PNG");
    expect(out.notes).toEqual([{ kind: "otherMode", position: 1, count: 1 }]);
  });

  it("merges the version 3 duplicates by their exact bytes", () => {
    const same = btoa("identical pixels");
    const other = btoa("different pixels"); // same length, same dimensions
    const frameWith = (layerBytes: string) => ({
      inputFrames: [
        {
          id: "f",
          mode: "reference",
          layers: [imageLayer("layer", { file: undefined, base64: layerBytes })],
          references: [reference("ref", { file: undefined, base64: same })],
        },
      ],
    });
    expect(shape(legacyToFrames(frameWith(same), cids()).frames[0])).toEqual(["ref*"]);
    expect(shape(legacyToFrames(frameWith(other), cids()).frames[0])).toEqual([
      "ref",
      "layer*(switch)",
    ]);
  });
});
