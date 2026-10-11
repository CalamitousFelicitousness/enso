import { describe, expect, it } from "vitest";
import type { BatchProgress } from "./batch";
import { advance, inPhase, PERCENT_AFTER_MS, visiblePercent } from "./progress";

const report = (over: Partial<BatchProgress> = {}): BatchProgress => ({
  phase: "uploading",
  sent: 0,
  total: 1000,
  done: 0,
  files: 2,
  ...over,
});

describe("advance", () => {
  it("is preparing while the batch claims", () => {
    const claiming = advance(undefined, report({ phase: "claiming" }), 0);
    expect(claiming.phase).toBe("preparing");
    expect(advance(claiming, report({ phase: "claiming" }), 5)).toBe(claiming);
  });

  it("changes only when the phase, the whole percentage or the files done do", () => {
    const first = advance(undefined, report({ sent: 100 }), 1000);
    expect(first).toMatchObject({ phase: "uploading", percent: 10, startedAt: 1000 });
    expect(advance(first, report({ sent: 105 }), 1100)).toBe(first);
    const next = advance(first, report({ sent: 210 }), 1200);
    expect(next).toMatchObject({ percent: 21, sent: 210, startedAt: 1000 });
    expect(advance(next, report({ sent: 210, done: 1 }), 1300)).toMatchObject({ done: 1 });
    expect(advance(next, report({ phase: "storing", sent: 1000 }), 1400)).toMatchObject({
      phase: "storing",
      percent: 100,
    });
  });

  it("changes when the percentage starts to show, and keeps showing it", () => {
    const first = advance(undefined, report({ sent: 100 }), 1000);
    expect(first.shown).toBe(false);
    const late = advance(first, report({ sent: 105 }), 1000 + PERCENT_AFTER_MS);
    expect(late).not.toBe(first);
    expect(late).toMatchObject({ percent: 10, shown: true });
    expect(advance(late, report({ sent: 300 }), 0).shown).toBe(true);
  });

  it("keeps the counts through a phase of its own", () => {
    const uploading = advance(undefined, report({ sent: 500, done: 1 }), 0);
    expect(inPhase(uploading, "sending")).toMatchObject({
      phase: "sending",
      percent: 100,
      done: 1,
    });
    expect(inPhase(undefined, "preparing")).toMatchObject({
      phase: "preparing",
      percent: 0,
      files: 0,
    });
  });
});

describe("visiblePercent", () => {
  const first = advance(undefined, report({ sent: 420 }), 1000);

  it("shows a percentage only once the uploads have run a second", () => {
    expect(visiblePercent(first)).toBeNull();
    expect(
      visiblePercent(advance(first, report({ sent: 430 }), 1000 + PERCENT_AFTER_MS - 1)),
    ).toBeNull();
    expect(visiblePercent(advance(first, report({ sent: 430 }), 1000 + PERCENT_AFTER_MS))).toBe(43);
  });

  it("shows none outside the upload", () => {
    const shown = advance(first, report({ sent: 430 }), 5000);
    expect(visiblePercent(undefined)).toBeNull();
    expect(visiblePercent(inPhase(shown, "sending"))).toBeNull();
  });
});
