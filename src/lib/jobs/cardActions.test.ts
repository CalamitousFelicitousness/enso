import { describe, expect, it } from "vitest";
import type { JobStatus } from "@/api/types/v2";
import { historySlots, queueSlots, resultActions, type JobFacts, type Slot } from "./cardActions";

const facts = (patch: Partial<JobFacts> = {}): JobFacts => ({
  domain: "generate",
  hasInputs: true,
  replay: null,
  routed: true,
  ...patch,
});

const shape = <A extends string>(slots: Slot<A>[]) =>
  slots.map((s) => `${s.action}:${s.reason ?? "ok"}`);

describe("historySlots", () => {
  it("gives a generation four fixed slots whatever its state", () => {
    const statuses: JobStatus[] = ["pending", "running", "completed", "failed", "cancelled"];
    for (const status of statuses) {
      const slots = historySlots(
        { type: "generate", status, hasParams: false, sentHere: false },
        facts(),
      );
      expect(slots.map((s) => s.action)).toEqual([
        "restoreSettings",
        "restoreBoth",
        "runAgain",
        "delete",
      ]);
    }
  });

  it("restores and runs again a generation this browser sent", () => {
    const done = historySlots(
      { type: "generate", status: "completed", hasParams: true, sentHere: false },
      facts(),
    );
    expect(shape(done)).toEqual([
      "restoreSettings:ok",
      "restoreBoth:ok",
      "runAgain:ok",
      "delete:ok",
    ]);
    const failed = historySlots(
      { type: "generate", status: "failed", hasParams: false, sentHere: false },
      facts(),
    );
    expect(shape(failed)).toEqual([
      "restoreSettings:ok",
      "restoreBoth:ok",
      "runAgain:ok",
      "delete:ok",
    ]);
    const running = historySlots(
      { type: "generate", status: "running", hasParams: false, sentHere: false },
      facts(),
    );
    expect(shape(running)).toEqual([
      "restoreSettings:ok",
      "restoreBoth:ok",
      "runAgain:unfinished",
      "delete:ok",
    ]);
  });

  it("says why for a generation without a record or without inputs", () => {
    const elsewhere = historySlots(
      { type: "generate", status: "completed", hasParams: true, sentHere: false },
      null,
    );
    expect(shape(elsewhere)).toEqual([
      "restoreSettings:ok",
      "restoreBoth:noRecord",
      "runAgain:noRecord",
      "delete:ok",
    ]);
    const failedElsewhere = historySlots(
      { type: "generate", status: "failed", hasParams: false, sentHere: false },
      null,
    );
    expect(shape(failedElsewhere).slice(0, 2)).toEqual([
      "restoreSettings:noRecord",
      "restoreBoth:noRecord",
    ]);
    const queuedElsewhere = historySlots(
      { type: "generate", status: "pending", hasParams: false, sentHere: false },
      null,
    );
    expect(shape(queuedElsewhere)[0]).toBe("restoreSettings:unfinished");
    const textOnly = historySlots(
      { type: "generate", status: "completed", hasParams: true, sentHere: false },
      facts({ hasInputs: false }),
    );
    expect(shape(textOnly)[1]).toBe("restoreBoth:noInputs");
    const lut = historySlots(
      { type: "generate", status: "completed", hasParams: true, sentHere: false },
      facts({ replay: "lutUpload" }),
    );
    expect(shape(lut)[2]).toBe("runAgain:lutUpload");
  });

  it("says a job this browser sent lost its record when it was sent", () => {
    const lost = historySlots(
      { type: "generate", status: "completed", hasParams: true, sentHere: true },
      null,
    );
    expect(shape(lost)).toEqual([
      "restoreSettings:ok",
      "restoreBoth:notStored",
      "runAgain:notStored",
      "delete:ok",
    ]);
    const failed = historySlots(
      { type: "generate", status: "failed", hasParams: false, sentHere: true },
      null,
    );
    expect(shape(failed)[0]).toBe("restoreSettings:notStored");
    const detail = historySlots(
      { type: "detail", status: "completed", hasParams: true, sentHere: true },
      null,
    );
    expect(shape(detail)[0]).toBe("runAgain:notStored");
  });

  it("gives other replayable types Run again and Delete, the rest Delete", () => {
    for (const type of ["detail", "cloud_image", "xyz-grid"]) {
      expect(
        shape(
          historySlots({ type, status: "completed", hasParams: true, sentHere: false }, facts()),
        ),
      ).toEqual(["runAgain:ok", "delete:ok"]);
    }
    for (const type of ["video", "upscale", "caption", "preprocess", "unknown"]) {
      expect(
        shape(
          historySlots({ type, status: "completed", hasParams: true, sentHere: false }, facts()),
        ),
      ).toEqual(["delete:ok"]);
    }
  });
});

describe("queueSlots", () => {
  const ends = { first: false, last: false };

  it("keeps three slots in every state", () => {
    const pending = queueSlots(
      { status: "pending", domain: "generate", hasResult: false },
      facts(),
      ends,
    );
    expect(shape(pending)).toEqual(["moveUp:ok", "moveDown:ok", "cancel:ok"]);
    const running = queueSlots(
      { status: "running", domain: "generate", hasResult: false },
      facts(),
      ends,
    );
    expect(shape(running)).toEqual(["moveUp:notQueued", "moveDown:notQueued", "cancel:ok"]);
    const done = queueSlots(
      { status: "completed", domain: "generate", hasResult: true },
      facts(),
      ends,
    );
    expect(shape(done)).toEqual(["view:ok", "runAgain:ok", "remove:ok"]);
  });

  it("disables the moves at the ends of the queue", () => {
    const only = queueSlots({ status: "pending", domain: "generate", hasResult: false }, facts(), {
      first: true,
      last: true,
    });
    expect(shape(only)).toEqual(["moveUp:first", "moveDown:last", "cancel:ok"]);
  });

  it("says why a finished job cannot be viewed or run again", () => {
    const failed = queueSlots(
      { status: "failed", domain: "generate", hasResult: false },
      null,
      ends,
    );
    expect(shape(failed)).toEqual(["view:noResult", "runAgain:notStored", "remove:ok"]);
    const grid = queueSlots(
      { status: "completed", domain: "xyz-grid", hasResult: true },
      facts(),
      ends,
    );
    expect(shape(grid)[0]).toBe("view:otherView");
    const video = queueSlots(
      { status: "completed", domain: "video", hasResult: true },
      facts({ domain: "video", replay: "video" }),
      ends,
    );
    expect(shape(video)).toEqual(["view:ok", "runAgain:video", "remove:ok"]);
  });
});

describe("resultActions", () => {
  it("offers everything for a result whose record holds its inputs", () => {
    expect(resultActions({ jobId: "j", type: "generate", legacyInputs: false }, facts())).toEqual({
      restoreSettings: null,
      restoreInputs: null,
      restoreBoth: null,
      runAgain: null,
    });
  });

  it("says why for results without a record, of older builds, or of other kinds", () => {
    expect(resultActions({ jobId: "j", type: "generate", legacyInputs: false }, null)).toEqual({
      restoreSettings: null,
      restoreInputs: "notStored",
      restoreBoth: "notStored",
      runAgain: "notStored",
    });
    expect(resultActions({ jobId: null, type: null, legacyInputs: false }, null)).toEqual({
      restoreSettings: null,
      restoreInputs: "olderResult",
      restoreBoth: "olderResult",
      runAgain: "olderResult",
    });
    // an older build that kept the inputs beside the result
    expect(
      resultActions({ jobId: null, type: null, legacyInputs: true }, null).restoreBoth,
    ).toBeNull();
    const cloud = resultActions({ jobId: "j", type: "cloud_image", legacyInputs: false }, facts());
    expect(cloud.restoreSettings).toBe("notGenerate");
    expect(cloud.restoreBoth).toBe("notGenerate");
    expect(cloud.restoreInputs).toBeNull();
  });
});
