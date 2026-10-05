import { describe, expect, it } from "vitest";
import { blobCid, planSweep, RETENTION_MS } from "./sweep";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
/** Longer than any retention worth having. */
const LONG_AGO = NOW - 3650 * DAY;

describe("blobCid", () => {
  it("is the key, or the part before a thumbnail suffix", () => {
    expect(blobCid("abc")).toBe("abc");
    expect(blobCid("abc/thumb")).toBe("abc");
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

  it("removes a blob or keeps it on record, never both and never neither", () => {
    const keys = ["a", "b", "b/thumb", "c"];
    const plan = planSweep(keys, new Set(["c"]), { a: LONG_AGO, b: NOW - 1 }, NOW);
    for (const key of ["a", "b", "b/thumb"]) {
      expect(plan.remove.includes(key)).not.toBe(Object.hasOwn(plan.orphans, key));
    }
    expect(plan.remove).not.toContain("c");
  });
});
