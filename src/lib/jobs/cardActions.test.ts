import { describe, expect, it } from "vitest";
import type { JobStatus } from "@/api/types/v2";
import {
  gallerySlots,
  historySlots,
  queueSlots,
  restoreInputsSlot,
  resultActions,
  runAgainSlot,
  sharedReason,
  type FactsState,
  type JobFacts,
  type Slot,
} from "./cardActions";

const facts = (patch: Partial<JobFacts> = {}): JobFacts => ({
  domain: "generate",
  mine: true,
  routed: true,
  hasInputs: true,
  missingRefs: 0,
  lost: 0,
  unavailable: 0,
  createdAt: 0,
  ...patch,
});

const shape = <A extends string>(slots: Slot<A>[]) =>
  slots.map((s) => `${s.action}:${s.reason ?? (s.note ? `note-${s.note}` : "ok")}`);

const done = (type: string, state: FactsState, status: JobStatus = "completed") =>
  shape(historySlots({ type, status, hasParams: true }, state));

describe("historySlots", () => {
  it("gives a generation four fixed slots whatever its state", () => {
    const statuses: JobStatus[] = ["pending", "running", "completed", "failed", "cancelled"];
    for (const status of statuses) {
      for (const state of [facts(), "loading", "none", "error"] as FactsState[]) {
        const slots = historySlots({ type: "generate", status, hasParams: false }, state);
        expect(slots.map((s) => s.action)).toEqual([
          "restoreSettings",
          "restoreBoth",
          "runAgain",
          "delete",
        ]);
      }
    }
  });

  it("restores and runs again a recorded generation, whichever browser sent it", () => {
    expect(done("generate", facts())).toEqual([
      "restoreSettings:ok",
      "restoreBoth:ok",
      "runAgain:ok",
      "delete:ok",
    ]);
    expect(done("generate", facts({ mine: false }))).toEqual(done("generate", facts()));
    expect(done("generate", facts(), "failed")).toEqual(done("generate", facts()));
    expect(done("generate", facts(), "running")[2]).toBe("runAgain:unfinished");
  });

  it("says Run again makes missing pictures again, or why it cannot", () => {
    expect(done("generate", facts({ missingRefs: 1 }))[2]).toBe("runAgain:note-remake");
    expect(done("generate", facts({ missingRefs: 1, hasInputs: false }))[2]).toBe("runAgain:gone");
    expect(done("generate", facts({ hasInputs: false }))[1]).toBe("restoreBoth:noInputs");
  });

  it("waits while the record is read, and says why when there is none or it cannot be read", () => {
    expect(done("generate", "loading")).toEqual([
      "restoreSettings:ok",
      "restoreBoth:loading",
      "runAgain:loading",
      "delete:ok",
    ]);
    expect(done("generate", "none")).toEqual([
      "restoreSettings:ok",
      "restoreBoth:noRecord",
      "runAgain:noRecord",
      "delete:ok",
    ]);
    expect(done("generate", "error").slice(1, 3)).toEqual([
      "restoreBoth:factsError",
      "runAgain:factsError",
    ]);
    // without a record the settings come from what the server returned
    const unanswered = historySlots(
      { type: "generate", status: "failed", hasParams: false },
      "none",
    );
    expect(shape(unanswered)[0]).toBe("restoreSettings:noRecord");
    const queued = historySlots({ type: "generate", status: "pending", hasParams: false }, "none");
    expect(shape(queued)[0]).toBe("restoreSettings:unfinished");
  });

  it("runs every recorded type again but Process now", () => {
    const types = ["detail", "cloud_image", "xyz-grid", "upscale", "rembg", "process"];
    for (const type of [...types, "video", "cloud_video", "framepack", "ltx"]) {
      expect(done(type, facts())).toEqual(["runAgain:ok", "delete:ok"]);
    }
    for (const type of ["preprocess", "caption"]) {
      expect(done(type, facts())).toEqual(["delete:ok"]);
    }
  });

  it("says a video job loads its own model, by name", () => {
    const [runAgain] = historySlots(
      { type: "video", status: "completed", hasParams: true, loads: { model: "WAN 2.2 A14B T2V" } },
      facts({ domain: "video", hasInputs: false }),
    );
    expect(runAgain).toEqual({
      action: "runAgain",
      reason: null,
      note: "loadsModel",
      model: "WAN 2.2 A14B T2V",
    });
  });
});

describe("runAgainSlot", () => {
  it("says why when the server has no records to give", () => {
    expect(runAgainSlot("runAgain", "completed", "off").reason).toBe("storeOff");
    expect(runAgainSlot("runAgain", "completed", "older").reason).toBe("olderServer");
  });

  it("notes the model only on a slot that can act", () => {
    const loads = { model: "LTXVideo 2.5 22B T2V Distilled" };
    expect(runAgainSlot("runAgain", "running", facts(), loads).note).toBeUndefined();
    expect(runAgainSlot("runAgain", "completed", "loading", loads).note).toBeUndefined();
    expect(runAgainSlot("runAgain", "completed", facts(), { model: null })).toEqual({
      action: "runAgain",
      reason: null,
      note: "loadsModel",
    });
  });
});

describe("queueSlots", () => {
  const ends = { first: false, last: false };
  const queue = (status: JobStatus, state: FactsState, domain: JobFacts["domain"] = "generate") =>
    shape(queueSlots({ status, domain, hasResult: status === "completed" }, state, ends));

  it("keeps three slots in every state", () => {
    expect(queue("pending", facts())).toEqual(["moveUp:ok", "moveDown:ok", "cancel:ok"]);
    expect(queue("running", facts())).toEqual([
      "moveUp:notQueued",
      "moveDown:notQueued",
      "cancel:ok",
    ]);
    expect(queue("completed", facts())).toEqual(["view:ok", "runAgain:ok", "remove:ok"]);
  });

  it("disables the moves at the ends of the queue", () => {
    const only = queueSlots({ status: "pending", domain: "generate", hasResult: false }, facts(), {
      first: true,
      last: true,
    });
    expect(shape(only)).toEqual(["moveUp:first", "moveDown:last", "cancel:ok"]);
  });

  it("says why a finished job cannot be viewed or run again", () => {
    expect(queue("failed", "none")).toEqual(["view:noResult", "runAgain:noRecord", "remove:ok"]);
    expect(queue("failed", "loading")[1]).toBe("runAgain:loading");
    expect(queue("completed", facts(), "xyz-grid")[0]).toBe("view:otherView");
    expect(queue("completed", facts({ domain: "video", hasInputs: false }), "video")).toEqual([
      "view:ok",
      "runAgain:ok",
      "remove:ok",
    ]);
    expect(
      queue("completed", facts({ domain: "video", hasInputs: false, missingRefs: 1 }), "video")[1],
    ).toBe("runAgain:gone");
    expect(queue("completed", facts({ missingRefs: 2 }))[1]).toBe("runAgain:note-remake");
  });
});

describe("resultActions", () => {
  const actions = (state: FactsState, patch: Partial<Parameters<typeof resultActions>[0]> = {}) => {
    const slots = resultActions(
      { jobId: "j", type: "generate", legacyInputs: false, ...patch },
      state,
    );
    return Object.fromEntries(
      Object.entries(slots).map(([action, slot]) => [action, shape([slot])[0]]),
    );
  };

  it("offers everything for a result whose record holds its inputs", () => {
    expect(actions(facts())).toEqual({
      restoreSettings: "restoreSettings:ok",
      restoreInputs: "restoreInputs:ok",
      saveInputs: "saveInputs:ok",
      restoreBoth: "restoreBoth:ok",
      runAgain: "runAgain:ok",
    });
  });

  it("says why for results without a record, of older builds, or of other kinds", () => {
    expect(actions("none")).toMatchObject({
      restoreSettings: "restoreSettings:ok",
      restoreInputs: "restoreInputs:noRecord",
      runAgain: "runAgain:noRecord",
    });
    expect(actions("loading")).toMatchObject({
      restoreInputs: "restoreInputs:loading",
      runAgain: "runAgain:loading",
    });
    expect(actions("none", { jobId: null, type: null })).toMatchObject({
      restoreSettings: "restoreSettings:ok",
      restoreInputs: "restoreInputs:olderResult",
      runAgain: "runAgain:olderResult",
    });
    // an older build kept the inputs beside the result
    expect(actions("none", { jobId: null, type: null, legacyInputs: true })).toMatchObject({
      restoreInputs: "restoreInputs:ok",
    });
    expect(actions(facts(), { type: "detail" })).toMatchObject({
      restoreSettings: "restoreSettings:notGenerate",
      restoreBoth: "restoreBoth:notGenerate",
    });
    expect(actions(facts({ hasInputs: false }))).toMatchObject({
      restoreInputs: "restoreInputs:noInputs",
      runAgain: "runAgain:ok",
    });
  });
});

describe("restoreInputsSlot", () => {
  const reason = (state: FactsState, legacy = false) =>
    restoreInputsSlot("restoreInputs", state, legacy).reason;

  it("restores an image job's inputs from its record", () => {
    expect(reason(facts())).toBeNull();
    expect(reason(facts({ hasInputs: false }))).toBe("noInputs");
  });

  it("refuses a job of any other kind", () => {
    expect(reason(facts({ domain: "video" }))).toBe("notGenerate");
    expect(reason(facts({ domain: "process" }))).toBe("notGenerate");
  });

  it("says why when the record cannot be had", () => {
    expect(reason("loading")).toBe("loading");
    expect(reason("none")).toBe("noRecord");
    expect(reason("error")).toBe("factsError");
    expect(reason("off")).toBe("storeOff");
    expect(reason("older")).toBe("olderServer");
  });

  it("restores what an older build kept beside a result", () => {
    expect(reason("none", true)).toBeNull();
  });
});

describe("gallerySlots", () => {
  const found = { state: "found", id: "j1" } as const;
  const slots = (job: Partial<Parameters<typeof gallerySlots>[0]>, state: FactsState = facts()) =>
    shape(gallerySlots({ lookup: found, running: false, ...job }, state));

  it("waits, quietly, while the file's job is looked up", () => {
    expect(slots({ lookup: { state: "loading" } })).toEqual([
      "restoreInputs:loading",
      "restoreBoth:loading",
      "runAgain:loading",
    ]);
  });

  it("says so when the file names no job, or the lookup failed", () => {
    expect(slots({ lookup: { state: "none" } })).toEqual([
      "restoreInputs:noJobFound",
      "restoreBoth:noJobFound",
      "runAgain:noJobFound",
    ]);
    expect(slots({ lookup: { state: "failed" } })).toEqual([
      "restoreInputs:lookupFailed",
      "restoreBoth:lookupFailed",
      "runAgain:lookupFailed",
    ]);
  });

  it("waits for a job this page is still running", () => {
    expect(slots({ running: true })).toEqual([
      "restoreInputs:unfinished",
      "restoreBoth:unfinished",
      "runAgain:unfinished",
    ]);
  });

  it("follows the record as every other view does", () => {
    expect(slots({})).toEqual(["restoreInputs:ok", "restoreBoth:ok", "runAgain:ok"]);
    expect(
      slots({ loads: { model: "Wan" } }, facts({ domain: "video", hasInputs: false })),
    ).toEqual(["restoreInputs:notGenerate", "restoreBoth:notGenerate", "runAgain:note-loadsModel"]);
    expect(slots({}, "off")).toEqual([
      "restoreInputs:storeOff",
      "restoreBoth:storeOff",
      "runAgain:storeOff",
    ]);
  });
});

describe("sharedReason", () => {
  it("is the reason every slot gives, else none", () => {
    const slot = (reason: Slot<"a">["reason"]): Slot<"a"> => ({ action: "a", reason });
    expect(sharedReason([slot("noJobFound"), slot("noJobFound")])).toBe("noJobFound");
    expect(sharedReason([slot("noJobFound"), slot("noRecord")])).toBeNull();
    expect(sharedReason([slot(null), slot(null)])).toBeNull();
    expect(sharedReason([])).toBeNull();
  });
});
