import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let undo: typeof import("./undo");

beforeEach(async () => {
  vi.resetModules();
  // the notices dismiss on the next frame
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => setTimeout(run, 0));
  undo = await import("./undo");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("an Undo offer that waits on bytes", () => {
  it("runs its undo as the Cancel of the wait, from Ctrl+Z as from the notice", async () => {
    const run = vi.fn();
    const offer = undo.offerUndo("Settings and inputs restored", null, run);
    offer.progress("Fetching 1 of 4 pictures");
    expect(await undo.runUndo()).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    // nothing is left to undo
    expect(await undo.runUndo()).toBe(false);
  });

  it("waits from the start when asked, its Undo the Cancel of the wait", async () => {
    const run = vi.fn();
    const offer = undo.offerUndo("Restoring inputs", null, run, { waiting: true });
    expect(await undo.runUndo()).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    // a cancelled change that lands after all offers nothing
    offer.update("Inputs restored", null);
    expect(await undo.runUndo()).toBe(false);
  });

  it("offers its Undo again once the change landed", async () => {
    const run = vi.fn();
    const offer = undo.offerUndo("Inputs restored", null, run);
    offer.progress("Fetching 1 of 1 picture");
    offer.update("Inputs restored", null);
    await undo.runUndo();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("is settled, not run, when another change takes the notice", () => {
    const run = vi.fn();
    const settle = vi.fn();
    const offer = undo.offerUndo("Inputs restored", null, run, { settle });
    offer.progress("Fetching 1 of 1 picture");
    undo.offerUndo("Picture removed", null, () => {});
    expect(settle).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });
});
