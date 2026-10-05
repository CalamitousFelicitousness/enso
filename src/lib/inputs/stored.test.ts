import { describe, expect, it } from "vitest";
import { frame, layer, maskObject, picture } from "./frames.fixture";
import {
  DOCUMENT_SCHEMA,
  joinFrames,
  joinWorking,
  namedCids,
  NewerDocument,
  readStoredFrames,
  readWorking,
  splitFrames,
  splitWorking,
  UnreadableDocument,
  type WorkingDocument,
} from "./stored";
import type { Frame } from "./types";

function sample(): Frame[] {
  const paint: Frame = {
    ...frame("paint", "initial", layer("base"), layer("top", { opacity: 0.5 })),
    mask: {
      objects: [maskObject("m")],
      strokes: [{ points: [1, 2, 3, 4], strokeWidth: 8, tool: "eraser" }],
    },
  };
  return [paint, frame("refs", "reference", picture("a"), picture("b", { visible: false }))];
}

describe("splitFrames and joinFrames", () => {
  it("round-trips frames through their stored form", () => {
    const frames = sample();
    const { frames: stored, blobs } = splitFrames(frames);
    const { frames: back, lost } = joinFrames(stored, blobs);
    expect(back).toEqual(frames);
    expect(back[0].pictures[0].file).toBe(frames[0].pictures[0].file);
    expect(lost).toEqual({ pictures: [], maskObjects: 0 });
  });

  it("stores no Blob in a frame", () => {
    const { frames: stored } = splitFrames(sample());
    const holdsBlob = (value: unknown): boolean =>
      value instanceof Blob ||
      (typeof value === "object" && value !== null && Object.values(value).some(holdsBlob));
    expect(holdsBlob(stored)).toBe(false);
    // and what is left survives the clone IndexedDB makes
    expect(structuredClone(stored)).toEqual(stored);
  });

  it("stores the bytes of pictures that share a cid once", () => {
    const original = picture("a");
    const copy = picture("copy", { cid: original.cid, file: original.file });
    const { blobs } = splitFrames([frame("f", "reference", original, copy)]);
    expect([...blobs.keys()]).toEqual(["cid-a"]);
  });

  it("keeps a picture whose bytes are gone and reports it once", () => {
    const { frames: stored, blobs } = splitFrames(sample());
    blobs.delete("cid-a");
    const first = joinFrames(stored, blobs);
    expect(first.frames[1].pictures[0].file).toBeNull();
    expect(first.lost.pictures).toEqual([{ frameId: "refs", name: "a.png" }]);
    // stored again while unreadable, it is no longer news
    const again = splitFrames(first.frames);
    expect(again.frames[1].pictures[0].missing).toBe(true);
    expect(joinFrames(again.frames, again.blobs).lost.pictures).toEqual([]);
  });

  it("drops a mask object whose bytes are gone and counts it", () => {
    const { frames: stored, blobs } = splitFrames(sample());
    blobs.delete("cid-m");
    const { frames, lost } = joinFrames(stored, blobs);
    expect(frames[0].mask.objects).toEqual([]);
    expect(frames[0].mask.strokes).toHaveLength(1);
    expect(lost.maskObjects).toBe(1);
  });

  it("lists every cid the frames name", () => {
    const { frames: stored } = splitFrames(sample());
    expect(namedCids(stored).sort()).toEqual(["cid-a", "cid-b", "cid-base", "cid-m", "cid-top"]);
  });
});

describe("readStoredFrames", () => {
  const stored = () => structuredClone(splitFrames(sample()).frames);

  it("accepts what splitFrames wrote", () => {
    expect(readStoredFrames(stored())).toEqual(stored());
  });

  it.each([
    ["no list", () => ({ frames: [] })],
    ["a frame that is not an object", () => ["frame"]],
    ["an unknown role", () => stored().map((f) => ({ ...f, role: "control" }))],
    ["a field it does not know", () => stored().map((f) => ({ ...f, futureField: 1 }))],
    ["a picture without a cid", () => [{ ...stored()[1], pictures: [{ id: "a" }] }]],
    [
      "a transform that is not finite",
      () => {
        const frames = stored();
        frames[0].pictures[0].transform!.x = Number.NaN;
        return frames;
      },
    ],
    [
      "a stroke with a point that is not a number",
      () => {
        const frames = stored();
        (frames[0].mask.strokes[0].points as unknown[])[1] = "2";
        return frames;
      },
    ],
  ])("refuses %s", (_name, build) => {
    expect(() => readStoredFrames(build())).toThrow(/stored inputs: unexpected value at/);
  });

  it("names the place it stopped at", () => {
    const frames = stored();
    (frames[1].pictures[1] as { opacity: unknown }).opacity = "1";
    expect(() => readStoredFrames(frames)).toThrow("frames[1].pictures[1].opacity");
  });
});

describe("the working document", () => {
  const doc = (): WorkingDocument => ({
    frames: sample(),
    selectedFrameId: "paint",
    activeItem: { frameId: "paint", id: "base" },
    sizeSource: { frameId: "refs", pictureId: null },
    imports: { "canvas-v4": "0badf00d" },
  });
  const record = () => structuredClone(splitWorking(doc(), 7).record);

  it("round-trips through its stored form", () => {
    const { record: stored, blobs } = splitWorking(doc(), 7);
    expect(stored.revision).toBe(7);
    const back = joinWorking(readWorking(structuredClone(stored)), blobs);
    expect(back.doc).toEqual(doc());
    expect(back.lost).toEqual({ pictures: [], maskObjects: 0 });
  });

  it("accepts a document with nothing selected", () => {
    const empty = { ...record(), selectedFrameId: null, activeItem: null, sizeSource: null };
    expect(readWorking(empty)).toEqual(empty);
  });

  it("refuses a schema newer than this build's without reading further", () => {
    const newer = { schema: DOCUMENT_SCHEMA + 1, somethingNew: true };
    expect(() => readWorking(newer)).toThrow(NewerDocument);
  });

  it.each([
    ["no record", () => null],
    ["a record without a schema", () => ({ ...record(), schema: undefined })],
    ["a record without a revision", () => ({ ...record(), revision: undefined })],
    ["a field it does not know", () => ({ ...record(), extra: 1 })],
    ["a selection that is not text", () => ({ ...record(), selectedFrameId: 3 })],
    ["a size source without a frame", () => ({ ...record(), sizeSource: { pictureId: null } })],
    ["an import mark that is not text", () => ({ ...record(), imports: { "canvas-v4": 4 } })],
  ])("refuses %s", (_name, build) => {
    expect(() => readWorking(build())).toThrow(UnreadableDocument);
  });
});
