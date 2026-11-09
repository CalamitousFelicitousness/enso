import { describe, expect, it } from "vitest";
import {
  COUNTING,
  doneText,
  NOTHING_STORED,
  rowDetail,
  ROW_NAMES,
  type ProfileMeasure,
} from "./text";
import { RESET_ROWS } from "./manifest";
import { clearsContent, DEFAULT_ROWS, shownRows } from "./rows";

const none: ProfileMeasure = {
  inputs: 0,
  pictures: 0,
  removals: 0,
  results: 0,
  videoResults: 0,
  videoInputs: 0,
  videoReferences: 0,
  presets: 0,
  prompts: 0,
  pinnedPrompts: 0,
  heldEntries: 0,
  heldRecords: 0,
  liveJobs: 0,
};

describe("rowDetail", () => {
  it("says Counting... for counted rows until the counts land", () => {
    expect(rowDetail("work", null)).toBe(COUNTING);
    expect(rowDetail("saved", null)).toBe(COUNTING);
    expect(rowDetail("legacy", null)).toBe(COUNTING);
    expect(rowDetail("parameters", null)).not.toBe(COUNTING);
    expect(rowDetail("interface", null)).not.toBe(COUNTING);
  });

  it("says Nothing stored when every count of a row is zero", () => {
    expect(rowDetail("work", none)).toBe(NOTHING_STORED);
    expect(rowDetail("saved", none)).toBe(NOTHING_STORED);
    expect(rowDetail("legacy", none)).toBe(NOTHING_STORED);
  });

  it("lists the work row's parts in order, leaving out zeros", () => {
    expect(
      rowDetail("work", {
        ...none,
        inputs: 3,
        pictures: 7,
        removals: 2,
        results: 24,
        videoResults: 5,
        videoInputs: 1,
        videoReferences: 2,
      }),
    ).toBe(
      "3 inputs with 7 pictures, 2 removed inputs in the trash, 24 results on the Result Strip, 5 results on the Video Result Strip, 1 video input and 2 video references.",
    );
    expect(rowDetail("work", { ...none, inputs: 1, pictures: 1 })).toBe("1 input with 1 picture.");
    expect(rowDetail("work", { ...none, results: 1, removals: 1 })).toBe(
      "1 removed input in the trash and 1 result on the Result Strip.",
    );
  });

  it("names pinned prompts only when there are some", () => {
    expect(rowDetail("saved", { ...none, presets: 4, prompts: 31, pinnedPrompts: 2 })).toBe(
      "4 presets you made and 31 prompts in the prompt history, pinned ones too.",
    );
    expect(rowDetail("saved", { ...none, prompts: 1 })).toBe("1 prompt in the prompt history.");
  });

  it("names what an older version kept and how to keep it", () => {
    expect(rowDetail("legacy", { ...none, heldEntries: 2, heldRecords: 1 })).toBe(
      "2 saved entries and 1 job record kept in this browser by an older version, not moved to the server. Move them from the Library first to keep them.",
    );
  });

  it("adds the running jobs to the Connection row only", () => {
    const base = rowDetail("connection", none);
    expect(rowDetail("connection", null)).toBe(base);
    expect(rowDetail("connection", { ...none, liveJobs: 1 })).toBe(
      `${base} 1 job from this browser is still running; its results go to History, not the strip.`,
    );
    expect(rowDetail("connection", { ...none, liveJobs: 3 })).toContain("3 jobs from this browser");
    expect(rowDetail("work", { ...none, liveJobs: 3 })).toBe(NOTHING_STORED);
  });
});

describe("doneText", () => {
  it("names what was cleared, then each note", () => {
    expect(doneText(["work", "interface"], [])).toBe("Cleared: inputs and results; interface.");
    expect(doneText(["connection"], ["session", "blocked"])).toBe(
      "Cleared: connection. The server could not be reached to end the sign-in. Some of it may not have been cleared; close every Enso tab, then reset again.",
    );
  });
});

describe("ROW_NAMES", () => {
  it("names every row", () => {
    for (const row of RESET_ROWS) expect(ROW_NAMES[row]).toBeTruthy();
  });
});

describe("shownRows", () => {
  it("shows Not yet on the server only while something is held", () => {
    expect(shownRows(null)).not.toContain("legacy");
    expect(shownRows(none)).not.toContain("legacy");
    expect(shownRows({ ...none, heldRecords: 1 })).toContain("legacy");
    expect(shownRows({ ...none, heldEntries: 1 })).toEqual(RESET_ROWS);
  });

  it("starts with the content rows checked, which also clear the caches", () => {
    expect(clearsContent(new Set(DEFAULT_ROWS))).toBe(true);
    expect(clearsContent(new Set(["work", "parameters", "saved"] as const))).toBe(false);
    expect(DEFAULT_ROWS).not.toContain("connection");
    expect(DEFAULT_ROWS).not.toContain("legacy");
  });
});
