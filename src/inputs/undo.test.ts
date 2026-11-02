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

  it("leaves nothing for the Top Bar once a cancelled change lands", async () => {
    const offer = undo.offerUndo("Restoring inputs", null, () => {}, { waiting: true });
    await undo.runUndo();
    offer.update("Inputs restored", null);
    expect(undo.useUndoOffer.getState().title).toBeNull();
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

describe("the offer the Top Bar shows", () => {
  const title = () => undo.useUndoOffer.getState().title;

  it("follows what the notice says until the offer ends", async () => {
    expect(title()).toBeNull();
    const offer = undo.offerUndo("Input 2 removed", null, () => {});
    expect(title()).toBe("Input 2 removed");
    offer.progress("Fetching 1 of 2 pictures");
    expect(title()).toBe("Fetching 1 of 2 pictures");
    offer.update("Inputs restored", null);
    expect(title()).toBe("Inputs restored");
    await undo.runUndo();
    expect(title()).toBeNull();
  });

  it("takes the newer offer's words, and clears when an offer is withdrawn", () => {
    undo.offerUndo("Input 2 removed", null, () => {});
    const second = undo.offerUndo('"photo.png" removed from Input 1', null, () => {});
    expect(title()).toBe('"photo.png" removed from Input 1');
    second.withdraw();
    expect(title()).toBeNull();
  });

  it("outlives its notice, closed or through the second button", async () => {
    const run = vi.fn();
    const settle = vi.fn();
    const open = vi.fn();
    undo.offerUndo("Input 2 removed", null, run, {
      settle,
      also: { label: "Show trash", onClick: open },
    });
    const shown = await lastNotice();
    expect(shown.cancel?.label).toBe("Show trash");
    shown.cancel?.onClick({} as never);
    expect(open).toHaveBeenCalledTimes(1);
    shown.onAutoClose?.(shown as never);
    expect(title()).toBe("Input 2 removed");
    expect(settle).not.toHaveBeenCalled();
    expect(await undo.runUndo()).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("ends with its notice when brief, settled and not run", async () => {
    const run = vi.fn();
    const settle = vi.fn();
    undo.offerUndo("3 results taken off the strip", null, run, { settle, brief: true });
    const shown = await lastNotice();
    shown.onAutoClose?.(shown as never);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(title()).toBeNull();
    expect(await undo.runUndo()).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("ends, settled and not run, when what it would bring back is deleted for good", async () => {
    const run = vi.fn();
    const settle = vi.fn();
    undo.offerUndo("Input 2 removed", null, run, { settle, tag: "record-1" });
    undo.endUndoFor("record-2");
    expect(title()).toBe("Input 2 removed");
    undo.endUndoFor("record-1");
    expect(settle).toHaveBeenCalledTimes(1);
    expect(title()).toBeNull();
    expect(await undo.runUndo()).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});

interface Shown {
  cancel?: { label: string; onClick: (event: never) => void };
  onAutoClose?: (toast: never) => void;
}

/** The notice offerUndo showed last. sonner's state outlives the module reset,
 * and its active list leaves out an id dismissed before; its history keeps
 * every notice shown. */
async function lastNotice(): Promise<Shown> {
  const { toast } = await import("sonner");
  const notice = toast
    .getHistory()
    .filter((t) => t.id === "inputs-undo")
    .pop();
  if (!notice) throw new Error("no notice shown");
  return notice as Shown;
}
