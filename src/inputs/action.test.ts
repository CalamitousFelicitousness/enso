import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Notices, RetryOffer } from "./action";

let action: typeof import("./action");
let progress: typeof import("./progress");
let UserAbortError: typeof import("@/lib/abort").UserAbortError;
let UploadRefused: typeof import("@/lib/media/refused").UploadRefused;
let LutRefused: typeof import("@/lib/lut").LutRefused;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("window", { location: { origin: "http://localhost:5174" } });
  action = await import("./action");
  progress = await import("./progress");
  ({ UserAbortError } = await import("@/lib/abort"));
  ({ UploadRefused } = await import("@/lib/media/refused"));
  ({ LutRefused } = await import("@/lib/lut"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const SETTINGS = { transient: false, cancelled: "Upload cancelled", failed: "Could not upload" };

function notices() {
  const said = {
    cancelled: [] as string[],
    refused: [] as [string, RetryOffer | null][],
    lut: [] as string[],
  };
  const tools: Notices = {
    cancelled: (text) => void said.cancelled.push(text),
    refused: (title, _err, offer) => void said.refused.push([title, offer]),
    lut: (err) => void said.lut.push(err.where),
  };
  return { said, tools };
}

/** A promise the test settles by hand. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

const slot = (key: string) => progress.useSubmitProgress.getState().byAction[key];

describe("a run", () => {
  it("answers its work's result and clears its slot when it ends", async () => {
    const { tools } = notices();
    const running = action.runAction(
      "caption",
      () => {
        expect(slot("caption")?.phase).toBe("preparing");
        return Promise.resolve(42);
      },
      SETTINGS,
      {},
      tools,
    );
    await expect(running).resolves.toBe(42);
    expect(slot("caption")).toBeUndefined();
  });

  it("leaves a newer run's slot and Stop alone when an older one ends", async () => {
    const { tools } = notices();
    const first = gate();
    const second = gate();
    const older = action.runAction("png", () => first.opened, SETTINGS, {}, tools);
    let newerSignal: AbortSignal | null = null;
    const newer = action.runAction(
      "png",
      ({ signal }) => {
        newerSignal = signal;
        return second.opened;
      },
      SETTINGS,
      {},
      tools,
    );
    first.open();
    await older;
    expect(slot("png")).toBeDefined();
    expect(progress.cancelAction("png")).toBe(true);
    expect(newerSignal!.aborted).toBe(true);
    second.open();
    await newer;
    expect(slot("png")).toBeUndefined();
  });

  it("stops an older run that has not sent its job, and leaves one that has", async () => {
    const { said, tools } = notices();
    const held = gate();
    let olderSignal: AbortSignal | null = null;
    const older = action.runAction(
      "images",
      ({ signal }) => {
        olderSignal = signal;
        return held.opened;
      },
      SETTINGS,
      {},
      tools,
    );
    const newer = action.runAction("images", () => Promise.resolve("job"), SETTINGS, {}, tools);
    expect(olderSignal!.aborted).toBe(true);
    held.open();
    await older;
    await expect(newer).resolves.toBe("job");
    expect(said.cancelled).toEqual([]);

    const posted = gate();
    let sendingSignal: AbortSignal | null = null;
    const sending = action.runAction(
      "images",
      async ({ signal, commit }) => {
        sendingSignal = signal;
        commit();
        await posted.opened;
        return "sent";
      },
      SETTINGS,
      {},
      tools,
    );
    const next = action.runAction("images", () => Promise.resolve("next"), SETTINGS, {}, tools);
    expect(sendingSignal!.aborted).toBe(false);
    posted.open();
    await expect(sending).resolves.toBe("sent");
    await next;
  });

  it("keeps saying its job is being sent once it commits, whatever its batch reports", () => {
    const { token } = progress.beginRun("video");
    progress.commitRun("video", token);
    progress.setRunPhase("video", token, "sending");
    progress.setRunProgress("video", token, {
      phase: "uploading",
      sent: 10,
      total: 100,
      done: 0,
      files: 1,
    });
    expect(slot("video")?.phase).toBe("sending");
    progress.endRun("video", token);
  });

  it("says a LUT it cannot send once, with its section, whether found early or late", async () => {
    const { said, tools } = notices();
    const early = action.runAction(
      "process",
      () => Promise.reject(new LutRefused("process", "grade.cube")),
      SETTINGS,
      {},
      tools,
    );
    await expect(early).resolves.toBeNull();
    expect(said.lut).toEqual(["process"]);
    expect(said.refused).toEqual([]);
    expect(slot("process")).toBeUndefined();
  });

  it("is cancelled by Stop until it commits, and says so once", async () => {
    const { said, tools } = notices();
    const committed = gate();
    const running = action.runAction(
      "video",
      async ({ commit }) => {
        await committed.opened;
        commit();
      },
      SETTINGS,
      {},
      tools,
    );
    expect(progress.cancelAction("video")).toBe(true);
    committed.open();
    await expect(running).resolves.toBeNull();
    expect(said.cancelled).toEqual(["Upload cancelled"]);

    const sending = gate();
    const posted = action.runAction(
      "video",
      async ({ commit }) => {
        commit();
        await sending.opened;
        return "job";
      },
      SETTINGS,
      {},
      tools,
    );
    await Promise.resolve();
    expect(progress.cancelAction("video")).toBe(false);
    sending.open();
    await expect(posted).resolves.toBe("job");
  });

  it("says nothing of a cancel when quiet, superseded, or a builder's own abort", async () => {
    const { said, tools } = notices();
    const stopped = async ({ signal }: { signal: AbortSignal }) => {
      await Promise.resolve();
      if (signal.aborted) throw new UserAbortError("stopped");
    };
    const quiet = action.runAction("q", stopped, SETTINGS, { quiet: true }, tools);
    progress.cancelAction("q");
    await quiet;

    const older = action.runAction("s", stopped, SETTINGS, {}, tools);
    progress.cancelAction("s");
    const newer = action.runAction("s", () => Promise.resolve(), SETTINGS, {}, tools);
    await Promise.all([older, newer]);

    await action.runAction(
      "b",
      () => Promise.reject(new UserAbortError("already said")),
      SETTINGS,
      {},
      tools,
    );
    expect(said.cancelled).toEqual([]);
  });

  it("says a refused upload with what retry offers, and leaves other errors to its caller", async () => {
    const { said, tools } = notices();
    const offer: RetryOffer = { label: "Retry", run: () => {} };
    const retry = vi.fn(() => offer);
    const refused = new UploadRefused({ kind: "network" });
    await expect(
      action.runAction("r", () => Promise.reject(refused), SETTINGS, { retry }, tools),
    ).resolves.toBeNull();
    expect(said.refused).toEqual([["Could not upload", offer]]);
    await expect(
      action.runAction("r", () => Promise.reject(new Error("boom")), SETTINGS, { retry }, tools),
    ).rejects.toThrow("boom");
    expect(retry).toHaveBeenCalledTimes(1);
    expect(slot("r")).toBeUndefined();
  });
});
