import { describe, expect, it } from "vitest";
import { isStale, readResetRecord, STALE_MS, writeResetRecord } from "./record";
import { firstRunState } from "./firstRun";

describe("the reset record", () => {
  it("reads back what it wrote, in each state", () => {
    const pending = { state: "pending", rows: ["work"], notes: ["session"], at: 5 } as const;
    expect(
      readResetRecord(writeResetRecord({ ...pending, rows: ["work"], notes: ["session"] })),
    ).toEqual(pending);
    const done = { state: "done", rows: [], notes: [], at: 5, postponed: true } as const;
    expect(readResetRecord(writeResetRecord({ ...done, rows: [], notes: [] }))).toEqual(done);
  });

  it("reads anything else as none", () => {
    expect(readResetRecord(null)).toBeNull();
    expect(readResetRecord("{")).toBeNull();
    expect(readResetRecord('{"state":"later","rows":[],"notes":[],"at":1}')).toBeNull();
    expect(
      readResetRecord('{"state":"pending","rows":["everything"],"notes":[],"at":1}'),
    ).toBeNull();
    expect(readResetRecord('{"state":"pending","rows":[],"notes":["why"],"at":1}')).toBeNull();
    expect(readResetRecord('{"state":"pending","rows":[],"notes":[]}')).toBeNull();
  });

  it("is stale a minute after it was written", () => {
    const record = { state: "running", rows: [], notes: [], at: 1000 } as const;
    expect(isStale({ ...record, rows: [], notes: [] }, 1000 + STALE_MS)).toBe(false);
    expect(isStale({ ...record, rows: [], notes: [] }, 1001 + STALE_MS)).toBe(true);
  });
});

describe("firstRunState", () => {
  it("is a first run with nothing of Enso kept but the reset's record", () => {
    expect(firstRunState(null, [])).toBe("first");
    expect(firstRunState(null, ["enso-reset", "modalZoom"])).toBe("first");
  });

  it("is an older profile with any other key of Enso", () => {
    expect(firstRunState(null, ["enso-ui"])).toBe("existing");
    expect(firstRunState(null, ["enso-session-mode"])).toBe("existing");
  });

  it("is marked with any marker value", () => {
    expect(firstRunState("", [])).toBe("marked");
    expect(firstRunState("garbage", ["enso-ui"])).toBe("marked");
  });
});
