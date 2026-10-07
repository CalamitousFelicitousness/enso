import { describe, expect, it } from "vitest";
import { frame, layer, maskObject, picture } from "./frames.fixture";
import { reportLines } from "./report";
import { defaultControl, defaultIpAdapter } from "./reducers";
import {
  DOCUMENT_SCHEMA,
  joinFrames,
  joinRemoval,
  joinSnapshot,
  joinWorking,
  MAP_SCHEMA,
  NewerDocument,
  readMap,
  readRemoval,
  readSnapshot,
  readStoredFrames,
  readWorking,
  splitFrames,
  splitRemoval,
  splitSnapshot,
  splitWorking,
  UnreadableDocument,
  type Removal,
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
    expect(readStoredFrames(stored).cids.sort()).toEqual([
      "cid-a",
      "cid-b",
      "cid-base",
      "cid-m",
      "cid-top",
    ]);
  });
});

/** A Control frame with its own picture and a processed map, one that borrows
 * its picture, and an IP-Adapter frame with a region mask. */
function controlSample(): Frame[] {
  const own: Frame = {
    ...frame("edges", "control", layer("e")),
    control: { ...defaultControl(), model: "Xinsir" },
    processor: { id: "Canny", params: { low_threshold: 100, color_map: "None" } },
  };
  const borrowed: Frame = { ...frame("borrow", "control"), fit: null, link: { frameId: "edges" } };
  const faces: Frame = {
    ...frame("faces", "ipAdapter", picture("face")),
    ipAdapter: { ...defaultIpAdapter(), adapter: "Base SDXL", masks: [picture("region")] },
  };
  return [own, borrowed, faces];
}

describe("control and IP-Adapter frames", () => {
  it("round-trip through their stored form", () => {
    const frames = controlSample();
    const { frames: stored, blobs } = splitFrames(frames);
    expect(joinFrames(stored, blobs).frames).toEqual(frames);
    expect(readStoredFrames(structuredClone(stored)).frames).toEqual(stored);
  });

  it("name the cids of region masks", () => {
    const { frames: stored } = splitFrames(controlSample());
    expect(readStoredFrames(stored).cids.sort()).toEqual(["cid-e", "cid-face", "cid-region"]);
  });

  it("refuse a processor parameter that is not a JSON value", () => {
    const { frames: stored } = splitFrames(controlSample());
    if (stored[0].processor) stored[0].processor.params["low_threshold"] = Number.NaN;
    expect(() => readStoredFrames(stored)).toThrow("frames[0].processor.params.low_threshold");
  });

  it("read a schema 2 frame's processor out of its control settings and drop its preview", () => {
    const { frames: stored } = splitFrames(controlSample());
    interface Schema2 {
      control: Record<string, unknown>;
      processor?: { id: string; params: unknown } | null;
      processed?: unknown;
    }
    const old = structuredClone(stored) as unknown as Schema2[];
    for (const f of old) {
      f.control["process"] = f.processor?.id ?? "None";
      f.control["processParams"] = f.processor?.params ?? {};
      delete f.processor;
      f.processed = null;
    }
    old[0].processed = { cid: "cid-map", width: 64, height: 64, missing: false };
    const { frames, cids, notes } = readStoredFrames(old, 2);
    expect(frames).toEqual(stored);
    expect(cids).not.toContain("cid-map");
    expect(notes).toEqual([{ kind: "previewDropped", position: 1 }]);
    // the fields that left are refused on a schema 3 record
    expect(() => readStoredFrames(old, 3)).toThrow(UnreadableDocument);
  });

  it("drop a schema 2 processor kept from a Control role, which did nothing, and say so", () => {
    const [stored] = splitFrames([frame("was-control", "initial", layer("w"))]).frames;
    const old = {
      ...structuredClone(stored),
      control: { ...defaultControl(), process: "Canny", processParams: { low_threshold: 50 } },
      processed: null,
    } as Record<string, unknown>;
    delete old["processor"];
    const { frames, notes } = readStoredFrames([old], 2);
    expect(frames[0].processor).toBeNull();
    expect(notes).toEqual([{ kind: "processorDropped", position: 1, processor: "Canny" }]);
    expect(
      reportLines({ lost: { pictures: [], maskObjects: 0 }, notes, legacyUnread: false }, () => 1),
    ).toEqual([
      "Input 1: the Canny processor it kept from when it was a Control frame is not carried over; it did nothing in this role.",
    ]);
  });
});

describe("readStoredFrames", () => {
  const stored = () => structuredClone(splitFrames(sample()).frames);

  it("accepts what splitFrames wrote", () => {
    expect(readStoredFrames(stored()).frames).toEqual(stored());
  });

  it("reads schema 1 frames with the later fields at their defaults", () => {
    const old = stored().map((f) => {
      const { fit, link, control, ipAdapter, processor, ...rest } = f;
      void [fit, link, control, ipAdapter, processor];
      return rest;
    });
    const { frames } = readStoredFrames(old, 1);
    expect(frames).toEqual(stored());
    expect(frames[0].control).toEqual(defaultControl());
    expect(() => readStoredFrames(old, 2)).toThrow(UnreadableDocument);
  });

  it.each([
    ["no list", () => ({ frames: [] })],
    ["a frame that is not an object", () => ["frame"]],
    ["an unknown role", () => stored().map((f) => ({ ...f, role: "video" }))],
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
    const back = joinWorking(readWorking(structuredClone(stored)).record, blobs);
    expect(back.doc).toEqual(doc());
    expect(back.lost).toEqual({ pictures: [], maskObjects: 0 });
  });

  it("accepts a document with nothing selected", () => {
    const empty = { ...record(), selectedFrameId: null, activeItem: null, sizeSource: null };
    expect(readWorking(empty).record).toEqual(empty);
  });

  it("reads a schema 1 document as schema 3", () => {
    const old = record() as unknown as { schema: number; frames: Record<string, unknown>[] };
    old.schema = 1;
    for (const f of old.frames) {
      for (const key of ["fit", "link", "control", "ipAdapter", "processor"]) delete f[key];
    }
    const { record: read, cids } = readWorking(old);
    expect(read.schema).toBe(3);
    expect(read.frames).toEqual(record().frames);
    expect(cids.sort()).toEqual(["cid-a", "cid-b", "cid-base", "cid-m", "cid-top"]);
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

describe("the inputs snapshot", () => {
  it("round-trips frames with the frame size", () => {
    const frames = sample();
    const size = { width: 640, height: 448 };
    const { record, blobs } = splitSnapshot(frames, size);
    const read = readSnapshot(record);
    expect(read.record).toEqual(record);
    expect([...read.cids].sort()).toEqual([...blobs.keys()].sort());
    const back = joinSnapshot(read.record, blobs);
    expect(back.frames).toEqual(frames);
    expect(back.size).toEqual(size);
    expect(back.lost).toEqual({ pictures: [], maskObjects: 0 });
  });

  it("refuses a snapshot without a size", () => {
    const { record } = splitSnapshot(sample(), { width: 8, height: 8 });
    expect(() => readSnapshot({ ...record, size: undefined })).toThrow(UnreadableDocument);
  });
});

describe("removal records", () => {
  const removals = (): Removal[] => {
    const [paint, refs] = sample();
    return [
      {
        removedAt: 1000,
        from: { position: 1, frameId: "paint", role: "initial" },
        content: { kind: "frame", index: 0, frame: paint, linkedFrom: ["edges"] },
      },
      {
        removedAt: 1001,
        from: { position: 1, frameId: "paint", role: "initial" },
        content: { kind: "contents", frame: paint },
      },
      {
        removedAt: 1002,
        from: { position: 2, frameId: "refs", role: "reference" },
        content: { kind: "picture", index: 1, picture: refs.pictures[1] },
      },
      {
        removedAt: 1003,
        from: { position: 1, frameId: "paint", role: "initial" },
        content: { kind: "frames", frames: [paint, refs] },
      },
    ];
  };

  it("round-trips every kind through its stored form", () => {
    for (const removal of removals()) {
      const { record, blobs } = splitRemoval(removal);
      expect(structuredClone(record)).toEqual(record);
      const read = readRemoval(record);
      expect(read.record).toEqual(record);
      expect(new Set(read.cids)).toEqual(new Set(blobs.keys()));
      const { removal: back, lost } = joinRemoval(read.record, blobs);
      expect(back).toEqual(removal);
      expect(lost).toEqual({ pictures: [], maskObjects: 0 });
    }
  });

  it("refuses a record with a kind or field it does not know", () => {
    const { record } = splitRemoval(removals()[2]);
    const content = record.content as Record<string, unknown>;
    expect(() => readRemoval({ ...record, content: { ...content, kind: "other" } })).toThrow(
      UnreadableDocument,
    );
    expect(() => readRemoval({ ...record, content: { ...content, extra: 1 } })).toThrow(
      UnreadableDocument,
    );
    expect(() => readRemoval({ ...record, schema: DOCUMENT_SCHEMA + 1 })).toThrow(NewerDocument);
  });

  it("notes a picture whose bytes are gone under the frame it came from", () => {
    const { record } = splitRemoval(removals()[2]);
    const { removal, lost } = joinRemoval(record, new Map());
    expect(removal.content.kind === "picture" && removal.content.picture.file).toBeNull();
    expect(lost.pictures).toEqual([{ frameId: "refs", name: "b.png" }]);
  });
});

describe("map records", () => {
  const map = () => ({
    schema: MAP_SCHEMA,
    key: 'Canny|1|{}|{"cid":"a","kind":"file"}',
    cid: "cid-map",
    width: 64,
    height: 64,
    madeAt: 1000,
    usedAt: 2000,
  });

  it("reads a record and names its cid", () => {
    const { record, cids } = readMap(map());
    expect(record).toEqual(map());
    expect(cids).toEqual(["cid-map"]);
  });

  it("refuses a newer schema and anything it does not know", () => {
    expect(() => readMap({ ...map(), schema: MAP_SCHEMA + 1 })).toThrow(NewerDocument);
    expect(() => readMap({ ...map(), extra: 1 })).toThrow(UnreadableDocument);
    expect(() => readMap({ ...map(), usedAt: "yesterday" })).toThrow(UnreadableDocument);
  });
});
