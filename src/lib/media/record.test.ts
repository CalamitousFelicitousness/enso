import { describe, expect, it } from "vitest";
import type { Source, StoredInputs } from "@/lib/inputs/stored";
import { RECORD_SCHEMA } from "@/lib/inputs/stored";
import { assembleRecord, type RecordParts } from "./record";

const composite: Source = {
  kind: "composite",
  frameId: "f1",
  drawnAt: { width: 64, height: 64 },
  encode: null,
};
const map: Source = { kind: "map", key: "k1", drawnAt: null, encode: null };

const inputs: StoredInputs = {
  schema: 3,
  size: { width: 64, height: 64 },
  sizeSource: null,
  frames: [],
};

const parts = (patch: Partial<RecordParts> = {}): RecordParts => ({
  client: "browser-1",
  checkpoint: { title: "model [abc]", name: "model" },
  request: { type: "generate", inputs: ["upload:h1"], control: [{ override: "upload:h2" }] },
  refs: { "upload:h1": composite, "upload:h2": map, "upload:old": composite },
  inputs,
  inputCids: ["c1", "c2", "c1"],
  mapKeys: ["k1", "k2"],
  maps: { k1: "m1" },
  hashes: new Map([
    ["c1", "a".repeat(64)],
    ["m1", "b".repeat(64)],
  ]),
  ...patch,
});

describe("assembleRecord", () => {
  it("pairs each cid with its hash once and declares the rest unavailable", () => {
    const record = assembleRecord(parts());
    expect(record.hashes).toEqual({ c1: "a".repeat(64), m1: "b".repeat(64) });
    expect(record.unavailable).toEqual(["c2"]);
  });

  it("keeps the sources of the refs the request names, and no others", () => {
    expect(Object.keys(assembleRecord(parts()).refs ?? {})).toEqual(["upload:h1", "upload:h2"]);
  });

  it("leaves out a sent map whose bytes did not get there, from the maps and the map keys", () => {
    const record = assembleRecord(parts({ hashes: new Map([["c1", "a".repeat(64)]]) }));
    expect(record.maps).toEqual({});
    expect(record.map_keys).toEqual(["k2"]);
    expect(record.unavailable).toEqual(["c2"]);
  });

  it("copies the inputs and the checkpoint, so the record does not change with them", () => {
    const given = parts();
    const record = assembleRecord(given);
    expect(record.inputs).toEqual(inputs);
    expect(record.inputs).not.toBe(inputs);
    expect(record.checkpoint).toEqual(given.checkpoint);
    expect(record.checkpoint).not.toBe(given.checkpoint);
    expect(record.client).toBe("browser-1");
  });

  it("records a job sent with no frames", () => {
    const record = assembleRecord(
      parts({ inputs: null, inputCids: [], refs: {}, request: { prompt: "a cat" } }),
    );
    expect(record.inputs).toBeNull();
    expect(record.refs).toEqual({});
    expect(record.unavailable).toEqual([]);
  });

  it("writes the schema that carries a file source's fit", () => {
    expect(assembleRecord(parts()).record_schema).toBe(RECORD_SCHEMA);
    expect(RECORD_SCHEMA).toBe(2);
  });
});
