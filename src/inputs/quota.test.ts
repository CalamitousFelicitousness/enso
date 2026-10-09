import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageProblem } from "@/lib/storageHealth";

let quota: typeof import("./quota");
let shown: StorageProblem["kind"][];

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const health = await import("@/lib/storageHealth");
  quota = await import("./quota");
  shown = [];
  health.onStorageProblem((problem) => shown.push(problem.kind));
});

afterEach(() => {
  vi.useRealTimers();
});

/** A write storage refuses `refusals` times and then takes; a refusal comes
 * a moment after the write, as IndexedDB's do. */
function write(refusals: number) {
  const attempt = vi.fn(() => {
    if (refusals-- > 0) {
      void Promise.resolve().then(() => quota.reportFull("Changes to the inputs", attempt));
    }
  });
  return attempt;
}

describe("once space is freed", () => {
  it("tries a refused write again until it is stored, the notice down meanwhile", async () => {
    const attempt = write(2);
    quota.reportFull("Changes to the inputs", attempt);
    quota.spaceFreed();
    await vi.runAllTimersAsync();
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(shown).toEqual(["full", "resolved"]);
  });

  it("stops trying once a pass stores everything", async () => {
    const attempt = write(0);
    quota.reportFull("Changes to the inputs", attempt);
    quota.spaceFreed();
    await vi.runAllTimersAsync();
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(shown).toEqual(["full", "resolved"]);
  });

  it("brings the notice back when the last pass is refused too", async () => {
    const attempt = write(Infinity);
    quota.reportFull("Changes to the inputs", attempt);
    quota.spaceFreed();
    await vi.runAllTimersAsync();
    expect(attempt).toHaveBeenCalledTimes(6);
    expect(shown).toEqual(["full", "resolved", "full"]);
  });

  it("brings it back for a refusal that comes before the last pass ends", async () => {
    const attempt = vi.fn(() => quota.reportFull("Changes to the inputs", attempt));
    quota.reportFull("Changes to the inputs", attempt);
    quota.spaceFreed();
    await vi.runAllTimersAsync();
    expect(shown).toEqual(["full", "resolved", "full"]);
  });
});
