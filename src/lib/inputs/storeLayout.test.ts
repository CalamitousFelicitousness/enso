import { describe, expect, it } from "vitest";
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
