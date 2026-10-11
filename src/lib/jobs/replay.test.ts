import { describe, expect, it } from "vitest";
import { frame, layer, maskObject, picture } from "@/lib/inputs/frames.fixture";
import { splitJob, type Source } from "@/lib/inputs/stored";
import {
  isUploadRef,
  refsIn,
  replayGone,
  replayNeeds,
  replayProblem,
  substituteRefs,
} from "./replay";

const composite: Source = {
  kind: "composite",
  frameId: "f1",
  drawnAt: { width: 64, height: 64 },
  encode: null,
};

describe("refsIn", () => {
  it("finds every upload ref in a request, however deep, once each", () => {
    const request = {
      inputs: ["upload:a", "upload:b"],
      inits: ["upload:a"],
      mask: "upload:c",
      control: [{ override: "upload:d", process: "None" }],
      ip_adapter: [{ images: ["upload:e"], masks: ["upload:f"] }],
      prompt: "uploads of cats",
      steps: 20,
    };
    expect(refsIn(request)).toEqual([
      "upload:a",
      "upload:b",
      "upload:c",
      "upload:d",
      "upload:e",
      "upload:f",
    ]);
  });

  it("takes any string that starts with upload: for a ref, as the server does", () => {
    expect(isUploadRef("upload:")).toBe(true);
    expect(isUploadRef("upload:x/y")).toBe(true);
    expect(isUploadRef(" upload:x")).toBe(false);
    expect(isUploadRef("Upload:x")).toBe(false);
    expect(refsIn({ grading_lut_file: "upload:lut", extra: { any: "upload:z" } })).toEqual([
      "upload:lut",
      "upload:z",
    ]);
  });
});

describe("substituteRefs", () => {
  it("substitutes refs in a copy and leaves the request as it was", () => {
    const request = {
      inputs: ["upload:a"],
      inits: ["upload:a"],
      control: [{ override: "upload:b" }],
    };
    const before = structuredClone(request);
    const out = substituteRefs(
      request,
      new Map([
        ["upload:a", "upload:x"],
        ["upload:b", "upload:y"],
      ]),
    );
    expect(out).toEqual({
      inputs: ["upload:x"],
      inits: ["upload:x"],
      control: [{ override: "upload:y" }],
    });
    expect(request).toEqual(before);
    expect(out.control).not.toBe(request.control);
  });
});

describe("replayProblem", () => {
  const facts = (patch: Partial<Parameters<typeof replayProblem>[0]> = {}) => ({
    domain: "generate" as const,
    missingRefs: 0,
    hasInputs: true,
    ...patch,
  });

  it("runs a job again as it was when the server holds every upload it names", () => {
    expect(replayProblem(facts())).toBeNull();
    expect(replayProblem(facts({ hasInputs: false }))).toBeNull();
  });

  it("makes missing uploads again from the saved inputs, or cannot without them", () => {
    expect(replayProblem(facts({ missingRefs: 2 }))).toBe("remake");
    expect(replayProblem(facts({ missingRefs: 2, hasInputs: false }))).toBe("gone");
  });

  it("runs a video job again while the server holds its files, and leaves Process now to its own", () => {
    expect(replayProblem(facts({ domain: "video", hasInputs: false }))).toBeNull();
    expect(replayProblem(facts({ domain: "framepack", hasInputs: false, missingRefs: 1 }))).toBe(
      "gone",
    );
    expect(replayProblem(facts({ domain: "preprocess" }))).toBe("processNow");
  });
});

describe("replayGone", () => {
  const paint = frame("f1", "initial", layer("base"));
  const stored = splitJob({
    id: "j",
    domain: "generate",
    createdAt: 1,
    checkpoint: null,
    request: { inputs: ["upload:a"], grading_lut_file: "upload:lut" },
    refs: { "upload:a": composite },
    inputs: { size: { width: 64, height: 64 }, sizeSource: null, frames: [paint] },
    mapKeys: [],
    maps: {},
    routed: false,
  }).record;

  it("makes a lost upload again while the pictures its source reads are held somewhere", () => {
    expect(replayGone(stored, ["upload:a"], () => false)).toBeNull();
  });

  it("names a picture its source reads that is held nowhere", () => {
    const cid = stored.inputs?.frames[0]?.pictures[0]?.cid ?? "";
    expect(replayGone(stored, ["upload:a"], (c) => c === cid)).toBe("picture");
  });

  it("names a lost upload with no source: the color LUT, or a file sent as it was", () => {
    expect(replayGone(stored, ["upload:lut"], () => false)).toBe("lut");
    expect(replayGone(stored, ["upload:other"], () => false)).toBe("file");
    const processed = {
      ...stored,
      request: { images: ["upload:p"], grading: { lut_cube_file: "upload:plut" } },
      refs: {},
      inputs: null,
    };
    expect(replayGone(processed, ["upload:plut"], () => false)).toBe("lut");
    expect(replayGone(processed, ["upload:p"], () => false)).toBe("file");
  });
});

describe("replayNeeds", () => {
  it("names the bytes each source draws from, once each", () => {
    const paint = {
      ...frame("paint", "initial", layer("base"), layer("hidden", { visible: false })),
      mask: { objects: [maskObject("m")], strokes: [] },
    };
    const refs = frame("refs", "reference", picture("a"), picture("b"));
    const { record } = splitJob({
      id: "j",
      domain: "generate",
      createdAt: 1,
      checkpoint: null,
      request: {
        inputs: ["upload:1", "upload:2", "upload:4"],
        mask: "upload:3",
        inits: ["upload:5"],
      },
      refs: {
        "upload:1": { ...composite, frameId: "paint" },
        "upload:2": { kind: "file", frameId: "refs", pictureId: "b" },
        "upload:3": { kind: "mask", frameId: "paint", drawnAt: { width: 64, height: 64 } },
        "upload:4": { kind: "map", key: "k", drawnAt: null, encode: null },
        "upload:5": {
          kind: "composite",
          frameId: "paint",
          drawnAt: { width: 32, height: 32 },
          encode: null,
        },
      },
      inputs: { size: { width: 64, height: 64 }, sizeSource: null, frames: [paint, refs] },
      mapKeys: [],
      maps: { k: "cid-map" },
      routed: false,
    });
    // the hidden layer is not drawn, and the second composite draws the same picture
    expect(replayNeeds(record)).toEqual(
      expect.arrayContaining([
        { cid: "cid-base", what: "picture" },
        { cid: "cid-b", what: "picture" },
        { cid: "cid-m", what: "mask" },
        { cid: "cid-map", what: "map" },
      ]),
    );
    expect(replayNeeds(record)).toHaveLength(4);
  });

  it("needs what cannot be there for a frame or picture the record lacks", () => {
    expect(
      replayNeeds({
        refs: { "upload:1": { kind: "file", frameId: "gone", pictureId: "x" } },
        inputs: null,
        maps: {},
      }),
    ).toEqual([{ cid: "missing:picture", what: "picture" }]);
  });
});
