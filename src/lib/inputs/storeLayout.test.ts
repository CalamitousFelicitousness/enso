import { describe, expect, it } from "vitest";
import { picture } from "./frames.fixture";
import { MAP_SCHEMA, splitRemoval } from "./stored";
import { readForSweep, RETENTION_MS } from "./sweep";
import {
  BLOBS,
  DOCUMENTS,
  JOBS,
  MAPS,
  META,
  READERS,
  SNAPSHOTS,
  STORES,
  TRASH,
} from "./storeLayout";

describe("store layout", () => {
  it("the store list and the sweep readers agree", () => {
    const documentStores = STORES.filter((name) => name !== BLOBS && name !== META);
    expect([...documentStores].sort()).toEqual(Object.keys(READERS).sort());
    expect([...STORES].sort()).toEqual(
      [BLOBS, DOCUMENTS, JOBS, MAPS, META, SNAPSHOTS, TRASH].sort(),
    );
  });

  it("reads a job record's cids and never lets it expire", () => {
    expect(
      READERS[JOBS]({
        schema: 1,
        id: "j",
        domain: "generate",
        createdAt: 1,
        checkpoint: null,
        request: { prompt: "x" },
        refs: {},
        inputs: null,
        mapKeys: [],
        maps: { k: "cid-map" },
        routed: true,
      }),
    ).toEqual({ cids: ["cid-map"] });
  });
});

describe("sweep policy", () => {
  it("an expired removal's cids are urgent in the same sweep and a map's are not", () => {
    const now = 10 * RETENTION_MS;
    const { record: removal } = splitRemoval({
      removedAt: now - RETENTION_MS,
      from: { position: 1, frameId: "f", role: "reference" },
      content: { kind: "picture", index: 0, picture: picture("p") },
    });
    const map = {
      schema: MAP_SCHEMA,
      key: "canny|k",
      cid: "cid-map",
      width: 8,
      height: 8,
      madeAt: 0,
      usedAt: now - RETENTION_MS,
    };
    const reading = readForSweep(
      [
        { store: TRASH, keys: ["r"], records: [removal] },
        { store: MAPS, keys: ["canny|k"], records: [map] },
      ],
      READERS,
      now,
    );
    expect([...reading.urgent]).toEqual(["cid-p"]);
    expect(reading.expired.map((e) => e.store)).toEqual([TRASH, MAPS]);
    expect(reading.named.size).toBe(0);
  });
});
