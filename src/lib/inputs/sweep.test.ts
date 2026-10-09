import { describe, expect, it } from "vitest";
import { blobCid, planSweep, readForSweep, RETENTION_MS, type StoreReader } from "./sweep";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
/** Longer than any retention worth having. */
const LONG_AGO = NOW - 3650 * DAY;

describe("blobCid", () => {
  it("is the key, or the part before a thumbnail suffix", () => {
    expect(blobCid("abc")).toBe("abc");
    expect(blobCid("abc/thumb")).toBe("abc");
    expect(blobCid("abc/thumb@320")).toBe("abc");
  });
});

describe("planSweep", () => {
  it("never removes a blob a document names, however long it was unnamed before", () => {
    const plan = planSweep(["a", "a/thumb"], new Set(["a"]), { a: LONG_AGO }, NOW);
    expect(plan).toEqual({ remove: [], orphans: {} });
  });

  it("never removes a blob it sees unnamed for the first time", () => {
    const plan = planSweep(["a", "a/thumb"], new Set(), {}, NOW);
    expect(plan).toEqual({ remove: [], orphans: { a: NOW, "a/thumb": NOW } });
  });

  it("keeps a blob, and when it went unnamed, until the retention period has passed", () => {
    const since = NOW - RETENTION_MS + 1;
    const plan = planSweep(["a"], new Set(), { a: since }, NOW);
    expect(plan).toEqual({ remove: [], orphans: { a: since } });
  });

  it("removes a blob once it has been unnamed for the retention period", () => {
    const since = NOW - RETENTION_MS;
    const plan = planSweep(["a", "a/thumb"], new Set(), { a: since, "a/thumb": since }, NOW);
    expect(plan).toEqual({ remove: ["a", "a/thumb"], orphans: {} });
  });

  it("counts a sighting dated after now from now", () => {
    const plan = planSweep(["a"], new Set(), { a: NOW + 3650 * DAY }, NOW);
    expect(plan).toEqual({ remove: [], orphans: { a: NOW } });
  });

  it("forgets blobs that are named again or gone", () => {
    const plan = planSweep(["a"], new Set(["a"]), { a: LONG_AGO, gone: LONG_AGO }, NOW);
    expect(plan.orphans).toEqual({});
  });

  it("removes an urgent blob nothing names at once, with its thumbnail", () => {
    const plan = planSweep(["a", "a/thumb@320", "b"], new Set(), {}, NOW, new Set(["a"]));
    expect(plan).toEqual({ remove: ["a", "a/thumb@320"], orphans: { b: NOW } });
  });

  it("never removes an urgent blob a document names", () => {
    const plan = planSweep(["a", "a/thumb@320"], new Set(["a"]), {}, NOW, new Set(["a"]));
    expect(plan).toEqual({ remove: [], orphans: {} });
  });

  it("removes a blob or keeps it on record, never both and never neither", () => {
    const keys = ["a", "b", "b/thumb", "c"];
    const plan = planSweep(keys, new Set(["c"]), { a: LONG_AGO, b: NOW - 1 }, NOW);
    for (const key of ["a", "b", "b/thumb"]) {
      expect(plan.remove.includes(key)).not.toBe(Object.hasOwn(plan.orphans, key));
    }
    expect(plan.remove).not.toContain("c");
  });
});

describe("readForSweep", () => {
  // A record here is { cids, expiresAt?, release? }; the readers say what it means.
  const facts = (record: unknown) =>
    record as { cids: string[]; expiresAt?: number; release?: boolean };
  const releasing: StoreReader = (record) => ({
    ...facts(record),
    inTrash: facts(record).release === true,
  });
  const keeping: StoreReader = (record) => facts(record);

  it("names what records that stay name, and lists the expired ones", () => {
    const reading = readForSweep(
      [
        {
          store: "docs",
          keys: ["d1", "d2"],
          records: [{ cids: ["a"] }, { cids: ["b"], expiresAt: NOW }],
        },
      ],
      { docs: keeping },
      NOW,
    );
    expect([...reading.named]).toEqual(["a"]);
    expect(reading.expired).toEqual([{ store: "docs", key: "d2" }]);
    expect([...reading.urgent]).toEqual([]);
  });

  it("makes an expired record's cids urgent only when its store releases them", () => {
    const reading = readForSweep(
      [
        { store: "trash", keys: ["t"], records: [{ cids: ["x"], expiresAt: 1, release: true }] },
        { store: "maps", keys: ["m"], records: [{ cids: ["y"], expiresAt: 1 }] },
      ],
      { trash: releasing, maps: keeping },
      NOW,
    );
    expect([...reading.urgent]).toEqual(["x"]);
    expect(reading.expired.map((e) => e.key)).toEqual(["t", "m"]);
  });

  it("keeps a record that has not expired, whatever its store releases", () => {
    const reading = readForSweep(
      [
        {
          store: "trash",
          keys: ["t"],
          records: [{ cids: ["x"], expiresAt: NOW + 1, release: true }],
        },
      ],
      { trash: releasing },
      NOW,
    );
    expect([...reading.named]).toEqual(["x"]);
    expect(reading.urgent.size).toBe(0);
    expect(reading.expired).toEqual([]);
  });

  it("refuses a store it has no reader for", () => {
    expect(() =>
      readForSweep([{ store: "other", keys: [1], records: [{ cids: [] }] }], {}, NOW),
    ).toThrow("no reader for other");
  });
});
