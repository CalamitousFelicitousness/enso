import { describe, expect, it } from "vitest";
import {
  aboutSize,
  ageText,
  batchText,
  lutGoneText,
  lutLineText,
  lutSummaryText,
  processOthersText,
  stopUploadText,
  deleteForEveryoneText,
  emptyBothText,
  fetchingText,
  inTrashText,
  keptOutText,
  libraryCapText,
  moveOfferText,
  moveStoppedText,
  movedAllText,
  movingText,
  notMovedText,
  otherTargetText,
  skipText,
  recordCapText,
  reductionText,
  retentionNoticeText,
  serverFreedText,
  storeOffText,
  storeRowText,
  submitFailureText,
  trashDaysBothText,
  trashHeaderText,
  unpinnedText,
  uploadFailureText,
  uploadingText,
} from "./text";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MB = 1024 * 1024;

describe("ageText", () => {
  it("dates a row in one style for every list", () => {
    expect(ageText(30_000)).toBe("just now");
    expect(ageText(5 * MINUTE)).toBe("5 min ago");
    expect(ageText(3 * HOUR + 59 * MINUTE)).toBe("3 h ago");
    expect(ageText(DAY)).toBe("1 day ago");
    expect(ageText(9 * DAY)).toBe("9 days ago");
  });
});

describe("aboutSize", () => {
  it("rounds to what people read", () => {
    expect(aboutSize(10)).toBe("about 1 KB");
    expect(aboutSize(85 * MB)).toBe("about 85 MB");
    expect(aboutSize(1.2 * 1024 * MB)).toBe("about 1.2 GB");
    expect(aboutSize(231 * 1024 * MB)).toBe("about 231 GB");
    expect(aboutSize(3.6 * 1024 * 1024 * MB)).toBe("about 3.6 TB");
  });
});

describe("uploadFailureText", () => {
  it("words each reason an upload did not land", () => {
    expect(
      uploadFailureText({ kind: "space", room: 1.2 * 1024 * MB, needed: 2.3 * 1024 * MB }),
    ).toBe("Not enough space on the server: this needs about 2.3 GB and it can take about 1.2 GB");
    expect(uploadFailureText({ kind: "full" })).toBe("The server's disk is full");
    expect(uploadFailureText({ kind: "stalled" })).toBe(
      "The upload stalled; check the connection and try again",
    );
    expect(uploadFailureText({ kind: "network" })).toBe("The server could not be reached");
    expect(uploadFailureText({ kind: "busy" })).toBe("The server is busy; try again in a minute");
    expect(uploadFailureText({ kind: "unreadable", names: ["cat.png"], total: 1 })).toBe(
      "cat.png can no longer be read; add it again",
    );
    expect(uploadFailureText({ kind: "unreadable", names: ["cat.png"], total: 40 })).toBe(
      "1 of 40 files can no longer be read: cat.png",
    );
    expect(uploadFailureText({ kind: "unreadable", names: ["a.png", "b.png"], total: 400 })).toBe(
      "2 of 400 files can no longer be read: a.png and b.png",
    );
    expect(
      uploadFailureText({ kind: "unreadable", names: ["a.png", "b.png", "c.png"], total: 400 }),
    ).toBe("3 of 400 files can no longer be read: a.png, b.png and 1 more");
    expect(
      uploadFailureText({ kind: "storeOff", message: "Media store off: /x is not writable" }),
    ).toBe("Media store off: /x is not writable");
  });
});

describe("the words of a submit", () => {
  it("say how far an upload has got", () => {
    expect(uploadingText(28)).toBe("Uploading 28%");
    expect(batchText(2, 3, 120 * MB, 480 * MB)).toBe(
      "Uploading 2 of 3 files, about 120 MB of 480 MB",
    );
    expect(batchText(0, 1, 0, 0)).toBe("Uploading 0 of 1 file");
    expect(fetchingText(1, 4, 120 * MB)).toBe("Fetching 1 of 4 pictures, about 120 MB");
    expect(fetchingText(0, 1, 0)).toBe("Fetching 0 of 1 picture");
  });

  it("say what was not kept with a job, and why a job was not sent", () => {
    expect(keptOutText(1, 1200 * MB)).toBe(
      "1 picture was not kept with the job: the server can take about 1.2 GB more",
    );
    expect(keptOutText(3, 5 * MB)).toBe(
      "3 pictures were not kept with the job: the server can take about 5 MB more",
    );
    expect(submitFailureText({ kind: "stillMissing", names: ["cat.png", "a", "b"] })).toBe(
      "The server does not hold cat.png and 2 more after a second try",
    );
    expect(submitFailureText({ kind: "stillMissing", names: [] })).toBe(
      "The server does not hold a picture after a second try",
    );
    expect(submitFailureText({ kind: "removed" })).toBe(
      "This job was queued before and has since been removed",
    );
    expect(submitFailureText({ kind: "tooLarge" })).toContain("too large");
  });
});

describe("the words of the library and its trash", () => {
  it("say why the store or an entry cannot be used", () => {
    expect(storeOffText("/x is not writable")).toBe("Media store off: /x is not writable");
    expect(storeOffText(null)).toBe("The media store is off");
    expect(notMovedText(1)).toBe("1 saved entry in this browser, not moved yet");
    expect(notMovedText(38)).toBe("38 saved entries in this browser, not moved yet");
    expect(inTrashText("Portrait")).toBe('"Portrait" is in the trash; restore it first');
    expect(unpinnedText(20)).toBe("It came back unpinned: 20 entries are pinned");
    expect(deleteForEveryoneText("Portrait", "alice")).toBe(
      'Delete "Portrait" for everyone? alice removed it. It cannot be brought back.',
    );
  });

  it("head the trash with what it holds here and on the server", () => {
    expect(trashHeaderText(12, 2, 85 * MB, 1.2 * 1024 * MB)).toBe(
      "12 removed inputs here · 2 saved entries on the server · about 85 MB here, about 1.2 GB on the server",
    );
    expect(trashHeaderText(1, 0, null, 5 * MB)).toBe("1 removed input here");
    expect(trashHeaderText(0, 1, null, 5 * MB)).toBe(
      "1 saved entry on the server · about 5 MB on the server",
    );
    expect(trashHeaderText(0, 0, 0, 0)).toBe("");
  });

  it("ask before emptying both parts, saying who removed the entries", () => {
    expect(emptyBothText(12, 2, { count: 1, name: "alice" }, 85 * MB, 1.2 * 1024 * MB)).toBe(
      "Delete 12 removed inputs from this browser and 2 saved entries (one removed by alice) for everyone? About 85 MB here and about 1.2 GB on the server are freed. They cannot be brought back.",
    );
    expect(emptyBothText(0, 3, { count: 2, name: null }, null, null)).toBe(
      "Delete 3 saved entries (2 removed by others) for everyone? They cannot be brought back.",
    );
    expect(emptyBothText(1, 0, { count: 0, name: null }, 2 * MB, null)).toBe(
      "Delete 1 removed input from this browser? About 2 MB here are freed. They cannot be brought back.",
    );
  });

  it("say what emptying freed on the server, and that the rest goes later", () => {
    expect(serverFreedText(85 * MB, 85 * MB)).toBe("about 85 MB freed on the server");
    expect(serverFreedText(85 * MB, 120 * MB)).toBe(
      "about 85 MB freed on the server; the rest goes within the week",
    );
    expect(serverFreedText(85 * MB, null)).toBe("about 85 MB freed on the server");
    expect(serverFreedText(0, null)).toBe("No space freed on the server yet");
    expect(serverFreedText(0, 85 * MB)).toBe(
      "No space freed on the server yet; it goes within the week",
    );
  });
});

describe("the words of the shared settings", () => {
  it("describe each row at rest and while lowered", () => {
    expect(trashDaysBothText(0, 0)).toBe("Removed inputs stay in the trash this long");
    expect(trashDaysBothText(3, 2)).toBe(
      "3 removed inputs in this browser go at the next start, 2 saved entries within 5 minutes",
    );
    expect(trashDaysBothText(1, 0)).toBe("1 removed input in this browser goes at the next start");
    expect(trashDaysBothText(0, 1)).toBe("1 saved entry in the trash goes within 5 minutes");
    expect(libraryCapText(0)).toBe("Past this, the least recently used entries move to the trash");
    expect(libraryCapText(1)).toBe("1 saved entry moves to the trash within 5 minutes");
    expect(libraryCapText(12)).toBe("12 saved entries move to the trash within 5 minutes");
    expect(recordCapText(0)).toBe("Each browser keeps this many job records on the server");
    expect(recordCapText(40)).toBe("40 of this browser's job records are deleted within 5 minutes");
  });

  it("ask before a reduction, with what it lets go for every browser", () => {
    expect(reductionText("trash_days", 1, { here: 3, server: 0 })).toEqual({
      title: "Keep removed inputs for 1 day?",
      description:
        "3 removed inputs in this browser go at the next start, for every browser. They cannot be brought back.",
    });
    expect(reductionText("library_cap", 50, { here: 0, server: 12 })).toEqual({
      title: "Keep 50 saved entries?",
      description: "12 saved entries move to the trash within 5 minutes, for every browser.",
    });
    expect(reductionText("record_cap", 50, { here: 40, server: 0 }).description).toBe(
      "40 of this browser's job records are deleted within 5 minutes, and other browsers' records past 50 too. Their results lose Restore inputs and Run again. They cannot be brought back.",
    );
    expect(reductionText("record_cap", 50, { here: 0, server: 0 }).description).toBe(
      "Every browser's job records past 50 are deleted within 5 minutes. Their results lose Restore inputs and Run again. They cannot be brought back.",
    );
  });

  it("say where the store is, what is free, and a root waiting for a restart", () => {
    const on = { enabled: true, reason: null, root: "/data/enso" };
    expect(storeRowText(on, 231 * 1024 * MB, "/data/enso")).toBe("/data/enso · about 231 GB free");
    expect(storeRowText(on, null, "/other")).toBe(
      "/data/enso · set to /other, applies after a restart",
    );
    expect(
      storeRowText({ enabled: false, reason: "/x is not writable", root: null }, null, null),
    ).toBe("Off: /x is not writable");
    expect(storeRowText({ enabled: false, reason: null, root: null }, null, null)).toBe(
      "Off: the server keeps no media store",
    );
  });

  it("offer a choice when the server keeps removed inputs for less time", () => {
    expect(retentionNoticeText(7, 30)).toEqual({
      title: "This server keeps removed inputs for 7 days; this browser kept them for 30 days.",
      description: "Removed inputs older than 7 days go at the next start.",
      keep: "Keep 30 days on the server",
      use: "Use 7 days",
    });
  });
});

describe("the words of moving this browser's older records", () => {
  it("offer the move with what goes, where and the room there", () => {
    expect(
      moveOfferText(
        38,
        120,
        { server: "127.0.0.1:7855", root: "/data/enso" },
        1.2 * 1024 * MB,
        231 * 1024 * MB,
      ),
    ).toEqual({
      title:
        "Move 38 saved entries and 120 job records to the server at 127.0.0.1:7855 (/data/enso)?",
      description: "About 1.2 GB; 231 GB free there.",
    });
    expect(moveOfferText(0, 1, { server: "host", root: null }, 2 * MB, null)).toEqual({
      title: "Move 1 job record to the server at host?",
      description: "About 2 MB.",
    });
    expect(notMovedText(3, 120)).toBe(
      "3 saved entries and 120 job records in this browser, not moved yet",
    );
  });

  it("say how far a move has got, and what it did", () => {
    expect(movingText(12, 158, 340 * MB, 1.2 * 1024 * MB)).toBe(
      "Moving 12 of 158, about 340 MB of 1.2 GB",
    );
    expect(movingText(0, 3, 0, 0)).toBe("Moving 0 of 3");
    expect(movedAllText({ entries: 38, records: 120 }, 3, 20, 5)).toEqual({
      title: "Moved 38 saved entries and 120 job records",
      description:
        "3 entries arrived unpinned: the server's 20 pins are taken. 5 skipped; they stay in this browser",
    });
    expect(movedAllText({ entries: 0, records: 0 }, 0, 20, 2)).toEqual({
      title: "Nothing was moved",
      description: "2 skipped; they stay in this browser",
    });
  });

  it("say why a move stopped and why an item stayed", () => {
    expect(moveStoppedText(507, 12)).toEqual({
      title: "The move stopped",
      description: "The server's disk is full. 12 moved so far; the rest stay in this browser",
    });
    expect(moveStoppedText(null, 0).description).toBe(
      "The server could not be reached. Nothing was moved",
    );
    expect(moveStoppedText("cancelled", 3).title).toBe("Move cancelled");
    expect(skipText({ code: "idle" })).toContain("90 days");
    expect(skipText({ code: "full", kind: "entry", cap: 100, count: 100 })).toBe(
      "The server's library is full (100 of 100)",
    );
    expect(skipText({ code: "full", kind: "record", cap: 200, count: 200 })).toBe(
      "This browser has 200 of 200 job records on the server",
    );
    expect(skipText({ code: "refused", status: 413, reason: "x" })).toBe(
      "Too large for the server",
    );
    expect(otherTargetText("a:1 (/x)", "b:2 (/y)")).toBe(
      "The move started toward a:1 (/x); this page is connected to b:2 (/y)",
    );
  });
});

describe("the words of an upload's slot", () => {
  it("say what Stop stops and what a run leaves out", () => {
    expect(stopUploadText(null)).toBe("Stop the upload");
    expect(stopUploadText(42)).toBe("Stop the upload, 42%");
    expect(processOthersText(397)).toBe("Process the other 397");
  });
});

describe("the words of a color LUT", () => {
  it("name the LUT and where to pick it again", () => {
    expect(lutGoneText("grade.cube", "images")).toBe(
      'The color LUT "grade.cube" is no longer stored; pick it again in the Color tab',
    );
    expect(lutGoneText("grade.cube", "process")).toBe(
      'The color LUT "grade.cube" is no longer stored; pick it again in Color Grading',
    );
  });

  it("give each state its line and its header", () => {
    const name = "grade.cube";
    expect(lutLineText({ kind: "none" })).toBeNull();
    expect(lutLineText({ kind: "ready", name })).toBeNull();
    expect(lutLineText({ kind: "checking", name })).toBe('Checking the server for "grade.cube"');
    expect(lutLineText({ kind: "held", name })).toBe('"grade.cube", getting it from the server');
    expect(lutLineText({ kind: "unverified", name })).toBe(
      'Could not ask the server for "grade.cube"; sending it asks again',
    );
    expect(lutLineText({ kind: "pickAgain", name })).toBe(
      '"grade.cube" is no longer stored; pick it again',
    );
    expect(lutSummaryText({ kind: "none" })).toBeNull();
    expect(lutSummaryText({ kind: "ready", name })).toBe(name);
    expect(lutSummaryText({ kind: "held", name })).toBe(name);
    expect(lutSummaryText({ kind: "pickAgain", name })).toBe("pick it again");
  });
});
