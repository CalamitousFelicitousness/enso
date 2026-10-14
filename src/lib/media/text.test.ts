import { describe, expect, it } from "vitest";
import {
  aboutSize,
  ageText,
  canvasTooLargeText,
  inputLimitLineText,
  inputLimitText,
  limitText,
  megapixelsText,
  readingText,
  refusalText,
  sizeText,
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
  trashDaysText,
  trashHeaderText,
  unpinnedText,
  uploadFailureText,
  uploadingText,
  cleanupText,
  diskText,
  filesText,
  lastVerifyText,
  pendingRootText,
  previousRootText,
  snapshotSavedText,
  snapshotsText,
  verifyingText,
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
    // nothing is not rounded up to something
    expect(aboutSize(0)).toBe("0 KB");
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
    // the reserve is above the free space: nothing fits, which "about 1 KB" would hide
    expect(uploadFailureText({ kind: "space", room: 0, needed: 125 * 1024 })).toBe(
      "Not enough space on the server: this needs about 125 KB and it has no room left",
    );
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
    expect(trashDaysText(0, 0, 0)).toBe(
      "Removed inputs, saved entries and files stay in the trash this long",
    );
    expect(trashDaysText(3, 2, 40)).toBe(
      "3 removed inputs in this browser go at the next start; 2 saved entries and 40 files on the server go within 5 minutes",
    );
    expect(trashDaysText(1, 0, 0)).toBe("1 removed input in this browser goes at the next start");
    expect(trashDaysText(0, 1, 0)).toBe("1 saved entry on the server goes within 5 minutes");
    expect(trashDaysText(0, 0, 1)).toBe("1 file on the server goes within 5 minutes");
    expect(trashDaysText(0, 1, 1)).toBe(
      "1 saved entry and 1 file on the server go within 5 minutes",
    );
    expect(libraryCapText(0)).toBe("Past this, the least recently used entries move to the trash");
    expect(libraryCapText(1)).toBe("1 saved entry moves to the trash within 5 minutes");
    expect(libraryCapText(12)).toBe("12 saved entries move to the trash within 5 minutes");
    expect(recordCapText(0)).toBe("Each browser keeps this many job records on the server");
    expect(recordCapText(40)).toBe("40 of this browser's job records are deleted within 5 minutes");
  });

  it("ask before a reduction, with what it lets go for every browser", () => {
    expect(reductionText("trash_days", 1, { here: 3, server: 0, files: 0 })).toEqual({
      title: "Keep the trash for 1 day?",
      description:
        "3 removed inputs in this browser go at the next start. They cannot be brought back.",
    });
    expect(reductionText("trash_days", 2, { here: 0, server: 2, files: 40 }).description).toBe(
      "2 saved entries and 40 files on the server go within 5 minutes, for everyone. They cannot be brought back.",
    );
    expect(reductionText("library_cap", 50, { here: 0, server: 12, files: 0 })).toEqual({
      title: "Keep 50 saved entries?",
      description: "12 saved entries move to the trash within 5 minutes, for every browser.",
    });
    expect(reductionText("record_cap", 50, { here: 40, server: 0, files: 0 }).description).toBe(
      "40 of this browser's job records are deleted within 5 minutes, and other browsers' records past 50 too. Their results lose Restore inputs and Run again. They cannot be brought back.",
    );
    expect(reductionText("record_cap", 50, { here: 0, server: 0, files: 0 }).description).toBe(
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
      title:
        "This server keeps its trash for 7 days; this browser kept removed inputs for 30 days.",
      description:
        "Removed inputs older than 7 days go at the next start. Saved entries and files in the trash stay that long too, for everyone.",
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

describe("the words of the media store panel", () => {
  const GB = 1024 * MB;
  const now = 10 * DAY;

  it("counts the files, the disk and a running verify", () => {
    expect(filesText(1, 512)).toBe("1 file, 512 B");
    expect(filesText(1234, 1.5 * GB)).toBe("1,234 files, 1.5 GB");
    expect(diskText(228 * GB, 3.6 * 1024 * GB)).toBe("228 GB free of 3.6 TB");
    expect(verifyingText(0, 0)).toBe("Starting the verify");
    expect(verifyingText(0, 1)).toBe("Checking 0 of 1 file");
    expect(verifyingText(1234, 5678)).toBe("Checking 1,234 of 5,678 files");
  });

  it("says how the last verify went, when the last cleanup ran, and where the store is", () => {
    const last = {
      at: now - 2 * HOUR,
      checked: 52,
      lost: 0,
      corrupt: 0,
      changed: 1,
      cancelled: false,
    };
    expect(lastVerifyText(null, now)).toBe("Not verified yet");
    expect(lastVerifyText(last, now)).toBe("Last verify 2 h ago: 52 checked, all intact");
    expect(lastVerifyText({ ...last, lost: 1, corrupt: 2 }, now)).toBe(
      "Last verify 2 h ago: 52 checked, 1 missing, 2 corrupt",
    );
    expect(lastVerifyText({ ...last, cancelled: true }, now)).toBe(
      "Last verify 2 h ago: 52 checked, all intact, cancelled",
    );
    expect(cleanupText(null, now)).toBe("Not yet");
    expect(cleanupText(now - 3 * MINUTE, now)).toBe("3 min ago");
    expect(snapshotsText(0, 0)).toBe("None");
    expect(snapshotsText(2, 18 * MB)).toBe("2 files, 18 MB");
    expect(snapshotSavedText("/store/snapshots/media-1.db", 18 * MB)).toBe(
      "/store/snapshots/media-1.db (18 MB)",
    );
    expect(pendingRootText("/mnt/new")).toBe("Set to /mnt/new, applies after a restart");
    expect(previousRootText("/old")).toBe("The store at /old was not moved");
  });
});

describe("the words of a picture's size", () => {
  it("writes a size with the multiplication sign", () => {
    expect(sizeText({ width: 1024, height: 768 })).toBe("1024×768");
  });

  it("gives megapixels to one decimal below 100 and whole above", () => {
    expect(megapixelsText(3840 * 3840)).toBe("14.7 MP");
    expect(megapixelsText(1024 * 1024)).toBe("1.0 MP");
    expect(megapixelsText(24000 * 18000)).toBe("432 MP");
    expect(megapixelsText(99_960_000)).toBe("100 MP");
  });

  it("gives a limit whole unless it is not", () => {
    expect(limitText(89_000_000)).toBe("89 MP");
    expect(limitText(12_500_000)).toBe("12.5 MP");
    expect(limitText(16384 * 16384)).toBe("268 MP");
  });

  it("says why a composite is too large to draw", () => {
    expect(canvasTooLargeText({ width: 20000, height: 20000 }, 16384 * 16384)).toBe(
      "The input goes out at 20000×20000 (400 MP), more than the 268 MP the browser can draw. Lower Width and Height, or use Megapixel.",
    );
  });
});

describe("the words of a refused picture", () => {
  const enso = { pixels: 16384 * 16384, by: "enso" } as const;
  const server = { pixels: 32_000_000, by: "server" } as const;

  it("names one file and gives its size against the limit", () => {
    expect(
      refusalText({ reason: "tooLarge", size: { width: 24000, height: 18000 }, limit: enso }, [
        "cat.png",
      ]),
    ).toEqual({
      title: "cat.png was not added",
      description: "It is 24000×18000 (432 MP); Enso takes pictures up to 268 MP.",
    });
    expect(
      refusalText({ reason: "tooLarge", size: { width: 8000, height: 6000 }, limit: server }, [
        "cat.png",
      ]).description,
    ).toBe(
      "It is 8000×6000 (48.0 MP); the server takes pictures up to 32 MP (Settings > Behavior > Largest input picture).",
    );
  });

  it("lists several files in one toast", () => {
    expect(
      refusalText({ reason: "tooLarge", size: { width: 24000, height: 18000 }, limit: enso }, [
        "cat.png",
        "dog.png",
        "owl.png",
      ]),
    ).toEqual({
      title: "3 pictures were not added",
      description: "cat.png, dog.png and 1 more are larger than the 268 MP Enso takes.",
    });
  });

  it("lists every format Enso reads for a file it cannot", () => {
    expect(refusalText({ reason: "notImage" }, ["cat.svg"])).toEqual({
      title: "cat.svg is not an image Enso can read",
      description: "Enso reads PNG, JPEG, WebP, GIF, BMP, TIFF, AVIF, HEIC, JPEG 2000 and JPEG XL.",
    });
    expect(refusalText({ reason: "notImage" }, ["a.svg", "b.ico"]).title).toBe(
      "2 files are not images Enso can read",
    );
  });

  it("says a large picture is being read", () => {
    expect(readingText("cat.png", 98_000_000)).toBe("Reading cat.png (98.0 MP)");
  });

  it("says which side cannot read the format, and when the size is missing", () => {
    expect(refusalText({ reason: "browserCannotShow", kind: "heic" }, ["cat.heic"])).toEqual({
      title: "cat.heic was not added",
      description: "This browser cannot show HEIC pictures.",
    });
    expect(
      refusalText({ reason: "serverCannotRead", kind: "jxl" }, ["a.jxl", "b.jxl"]).description,
    ).toBe("The server cannot read JPEG XL pictures: a.jxl and b.jxl.");
    expect(refusalText({ reason: "noSize" }, ["cat.jpg"]).description).toBe(
      "Enso could not find its size in the file.",
    );
  });
});

describe("the words of the input limit", () => {
  it("says what is refused at or below the browser's ceiling", () => {
    expect(inputLimitText(89_000_000)).toBe(
      "Larger pictures are refused when added, uploaded or sent in a request. Nothing stored is deleted.",
    );
  });

  it("says the browser refuses first above it", () => {
    expect(inputLimitText(768_000_000)).toBe(
      "Larger uploads and requests are refused. Enso already refuses pictures above 500 MP when they are added.",
    );
  });

  it("gives the server's limit and the browser's in the System line", () => {
    expect(inputLimitLineText(89_000_000)).toBe("89 MP on the server · 500 MP in the browser");
    expect(inputLimitLineText(null)).toBe("500 MP in the browser");
  });
});
