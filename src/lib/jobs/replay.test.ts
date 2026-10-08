import { describe, expect, it } from "vitest";
import { frame, layer, maskObject, picture } from "@/lib/inputs/frames.fixture";
import { splitJob, type Source, type StoredJob } from "@/lib/inputs/stored";
import { isUploadRef, refsIn, replayNeeds, replayProblem, substituteRefs } from "./replay";

const composite: Source = {
  kind: "composite",
  frameId: "f1",
  drawnAt: { width: 64, height: 64 },
  encode: null,
};

function job(patch: Partial<StoredJob> = {}): StoredJob {
  return {
    schema: 1,
    id: "job-1",
    domain: "generate",
    createdAt: 1,
    checkpoint: null,
    request: { type: "generate", prompt: "a cat", inputs: ["upload:a"] },
    refs: { "upload:a": composite },
    inputs: { schema: 3, size: { width: 64, height: 64 }, sizeSource: null, frames: [] },
    mapKeys: [],
    maps: {},
    routed: false,
    ...patch,
  };
}

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
  it("names why a record cannot be run again", () => {
    expect(replayProblem(job())).toBeNull();
    expect(replayProblem(job({ domain: "video" }))).toBe("video");
    expect(replayProblem(job({ domain: "framepack" }))).toBe("video");
    expect(replayProblem(job({ domain: "preprocess" }))).toBe("processNow");
    // an upload with no source: the LUT, or anything else
    expect(
      replayProblem(job({ request: { inputs: ["upload:a"], grading_lut_file: "upload:lut" } })),
    ).toBe("lutUpload");
    expect(replayProblem(job({ request: { inputs: ["upload:z"] } }))).toBe("unrecordedUploads");
    // a source from the frames, with no frames kept
    expect(replayProblem(job({ inputs: null }))).toBe("unrecordedUploads");
    // a map sent as a picture whose bytes the record does not name
    const map: Source = { kind: "map", key: "k1", drawnAt: null, encode: null };
    expect(replayProblem(job({ refs: { "upload:a": map } }))).toBe("unrecordedUploads");
    expect(replayProblem(job({ refs: { "upload:a": map }, maps: { k1: "cid-k1" } }))).toBeNull();
  });

  it("runs a job sent with no pictures again", () => {
    expect(replayProblem(job({ request: { prompt: "a cat" }, refs: {}, inputs: null }))).toBeNull();
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
