import { describe, expect, it } from "vitest";
import { picture } from "./frames.fixture";
import { MAP_SCHEMA, splitEntry, splitRemoval } from "./stored";
import { readForSweep, RETENTION_MS } from "./sweep";
import {
  BLOBS,
  DOCUMENTS,
  JOBS,
  LIBRARY,
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
      [BLOBS, DOCUMENTS, JOBS, LIBRARY, MAPS, META, SNAPSHOTS, TRASH].sort(),
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
      cause: "removed",
      size: { width: 8, height: 8 },
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

describe("library entries in the sweep", () => {
  const record = (trashedAt: number | null) =>
    splitEntry({
      id: "e",
      kind: "frame",
      name: "x",
      savedAt: 0,
      usedAt: 0,
      pinned: false,
      trashedAt,
      inputs: { size: { width: 8, height: 8 }, sizeSource: null, frames: [] },
      maps: { k: "cid-map" },
    }).record;

  it("keeps an entry in the library for good", () => {
    expect(READERS[LIBRARY](record(null))).toEqual({ cids: ["cid-map"] });
  });

  it("lets a trashed entry expire with the removals, its bytes going with it", () => {
    const facts = READERS[LIBRARY](record(5));
    expect(facts.expiresAt).toBe(5 + RETENTION_MS);
    expect(facts.inTrash).toBe(true);
  });
});
