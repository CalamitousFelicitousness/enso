import { describe, expect, it } from "vitest";
import {
  claimBytes,
  planBatch,
  progressOf,
  roomOf,
  type ClaimAnswer,
  type PlanItem,
} from "./batch";

const MB = 1024 * 1024;
const GB = 1024 * MB;

const item = (id: string, patch: Partial<PlanItem> = {}): PlanItem => ({
  id,
  hash: null,
  size: MB,
  record: false,
  ...patch,
});

/** The server's answer, its `needed` being the claimed bytes plus `reserve`. */
function answer(present: string[], free: number, claimed: number, reserve = 0): ClaimAnswer {
  return { present, missing: [], lost: [], space: { free, needed: claimed + reserve } };
}

describe("claimBytes", () => {
  it("counts the items with no known hash, a maker's unknown size as nothing", () => {
    expect(claimBytes([item("a"), item("b", { hash: "h" }), item("c", { size: null })])).toBe(MB);
  });
});

describe("roomOf", () => {
  it("is the free space less the reserve and the uploads in flight", () => {
    // needed = 1 GB claimed + 2 GB reserve + 1 GB another client is sending
    expect(roomOf({ free: 10 * GB, needed: 4 * GB }, GB)).toBe(7 * GB);
    expect(roomOf({ free: GB, needed: 4 * GB }, GB)).toBe(0);
  });
});

describe("planBatch", () => {
  it("uploads every item with no known hash", () => {
    const items = [item("a"), item("b")];
    const plan = planBatch(items, answer([], 10 * GB, claimBytes(items)), claimBytes(items));
    expect(plan.upload).toEqual(["a", "b"]);
    expect(plan.held.size).toBe(0);
  });

  it("sends a remembered item as it is only when the server holds its hash", () => {
    const items = [item("held", { hash: "h1" }), item("lost", { hash: "h2" })];
    const plan = planBatch(items, answer(["h1"], 10 * GB, 0), 0);
    expect([...plan.held]).toEqual([["held", "h1"]]);
    expect(plan.upload).toEqual(["lost"]);
  });

  it("refuses before any upload when the request's items need more than the room", () => {
    const items = [item("a", { size: 3 * GB })];
    const plan = planBatch(items, answer([], 4 * GB, 3 * GB, 2 * GB), 3 * GB);
    expect(plan.refused).toEqual({ room: 2 * GB, needed: 3 * GB });
    expect(plan.upload).toEqual([]);
  });

  it("fits record-only items smallest first into what the request leaves", () => {
    const items = [
      item("request", { size: 5 * MB }),
      item("big", { size: 8 * MB, record: true }),
      item("small", { size: 2 * MB, record: true }),
      item("mid", { size: 3 * MB, record: true }),
    ];
    const claimed = claimBytes(items);
    // room: 11 MB; the request takes 5, small and mid fit, big does not
    const plan = planBatch(items, answer([], claimed + 11 * MB, claimed, claimed), claimed);
    expect(plan.refused).toBeNull();
    expect(plan.upload).toEqual(["request", "small", "mid"]);
    expect(plan.leftOut).toEqual(["big"]);
  });

  it("never leaves out a request's item for a record's", () => {
    const items = [item("request", { size: 4 * MB }), item("record", { size: MB, record: true })];
    const claimed = claimBytes(items);
    const plan = planBatch(items, answer([], 4 * MB, claimed, 0), claimed);
    expect(plan.upload).toEqual(["request"]);
    expect(plan.leftOut).toEqual(["record"]);
  });
});

describe("progressOf", () => {
  it("sums the bytes and files, and reads storing once every byte is sent", () => {
    expect(
      progressOf([
        { sent: 5, total: 10, done: false },
        { sent: 10, total: 10, done: true },
      ]),
    ).toEqual({ phase: "uploading", sent: 15, total: 20, done: 1, files: 2 });
    expect(
      progressOf([
        { sent: 10, total: 10, done: false },
        { sent: 10, total: 10, done: true },
      ]).phase,
    ).toBe("storing");
  });
});
