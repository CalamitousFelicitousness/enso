import { describe, expect, it } from "vitest";
import {
  clearHistoryTitle,
  closedPageText,
  fromThisBrowserText,
  noteText,
  outputJobText,
  reasonText,
  replayMissingText,
  restoreNotesText,
  runAgainQueuedText,
  stripLimitText,
  stripTrimmedText,
} from "./text";

describe("job words", () => {
  it("counts the jobs that ended while the page was closed", () => {
    expect(closedPageText(0, 0)).toBeNull();
    expect(closedPageText(1, 0)).toBe("1 job finished while the page was closed");
    expect(closedPageText(3, 0)).toBe("3 jobs finished while the page was closed");
    expect(closedPageText(2, 1)).toBe("2 jobs finished and 1 failed while the page was closed");
    expect(closedPageText(0, 2)).toBe("2 jobs failed while the page was closed");
  });

  it("says what a strip limit below the count takes off", () => {
    expect(stripLimitText(10, 16)).toBe("10 on the strip now");
    expect(stripLimitText(10, 9)).toBe("1 older result will leave the strip");
    expect(stripLimitText(10, 4)).toBe("6 older results will leave the strip");
    expect(stripTrimmedText(1).title).toBe("1 older result removed from the strip");
    expect(stripTrimmedText(6)).toEqual({
      title: "6 older results removed from the strip",
      description: "They stay in History",
    });
  });

  it("joins what a restore left as it was", () => {
    expect(restoreNotesText([])).toBeNull();
    expect(restoreNotesText(["seedNotRecorded", "lutNotRestored"])).toBe(
      "Seed not recorded for this result; it stays random. Color LUT not restored",
    );
  });
});

describe("Run again words", () => {
  it("say what loading a job's own model does, by name when there is one", () => {
    expect(noteText("loadsModel", "WAN 2.2 A14B T2V")).toBe(
      "Loads WAN 2.2 A14B T2V first, in place of the loaded model",
    );
    expect(noteText("loadsModel")).toBe(
      "Loads the job's video model first, in place of the loaded model",
    );
    expect(runAgainQueuedText({ model: "FramePack I2V HY" })).toBe(
      "Job queued again; it loads FramePack I2V HY first, in place of the loaded model",
    );
    expect(runAgainQueuedText(null)).toBe("Job queued again");
  });

  it("name what a job sent that is gone", () => {
    expect(replayMissingText("lut")).toBe("The color LUT this job sent is no longer stored");
    expect(replayMissingText("file")).toBe("A file this job sent is no longer stored");
    expect(reasonText("gone")).toBe(replayMissingText("file"));
    expect(reasonText("storeOff")).toBe("Job records are unavailable while the media store is off");
  });
});

describe("the job a file came from", () => {
  const now = 10 * 86_400_000;
  const found = { state: "found", id: "0123abcd4567ef89" } as const;

  it("is looked up, missing, unreadable, known by id, or known by its record", () => {
    expect(outputJobText({ state: "loading" }, null, now)).toBe("Looking up the job");
    expect(outputJobText({ state: "none" }, null, now)).toBe("No Enso job found for this file");
    expect(outputJobText({ state: "failed" }, null, now)).toBe("Could not look up the job");
    expect(outputJobText(found, null, now)).toBe("From Enso job 0123abcd");
    expect(outputJobText(found, { domain: "generate", createdAt: now - 3 * 86_400_000 }, now)).toBe(
      "From an Enso image job, 3 days ago",
    );
    expect(outputJobText(found, { domain: "framepack", createdAt: now }, now)).toBe(
      "From an Enso FramePack job, just now",
    );
  });
});

describe("clearing the finished jobs", () => {
  it("asks with the server's count, and says how many this browser sent", () => {
    expect(clearHistoryTitle(380)).toBe("Remove 380 finished jobs from the server?");
    expect(clearHistoryTitle(1)).toBe("Remove 1 finished job from the server?");
    expect(clearHistoryTitle(null)).toBe("Remove every finished job from the server?");
    expect(fromThisBrowserText(12)).toBe("12 are from this browser.");
    expect(fromThisBrowserText(1)).toBe("1 is from this browser.");
    expect(fromThisBrowserText(0)).toBeNull();
  });
});
