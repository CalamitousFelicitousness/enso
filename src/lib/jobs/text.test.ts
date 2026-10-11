import { describe, expect, it } from "vitest";
import {
  closedPageText,
  noteText,
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
