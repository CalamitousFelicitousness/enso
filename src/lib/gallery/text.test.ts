import { describe, expect, it } from "vitest";
import {
  deleteFilesNowText,
  deleteFilesNowTitle,
  emptyGalleryTrashText,
  filesInTrashLineText,
  filesMovedToTrashText,
  filesRestoredText,
  fileStateLabel,
  fileStateText,
  fileTrashReason,
  hiddenBySearchText,
  hiddenLeftText,
  inTrashChipText,
  inTrashOfText,
  moveManyText,
  moveManyTitle,
  notTrashedText,
  restoredAsText,
  restoredWithoutText,
  restoreToTitle,
  trashFolderText,
  trashLineText,
  wasInText,
} from "./text";

const GB = 1024 * 1024 * 1024;
const nobody = { count: 0, name: null };

describe("the Gallery trash's words", () => {
  it("names one file and counts several", () => {
    expect(filesMovedToTrashText(1, "00044.png")).toBe('"00044.png" moved to the trash');
    expect(filesMovedToTrashText(3, "00044.png")).toBe("3 files moved to the trash");
    expect(filesRestoredText(1, "a.png")).toBe('"a.png" restored');
    expect(filesRestoredText(1200, "a.png")).toBe("Restored 1,200 files");
    expect(notTrashedText(1)).toBe("1 file was not moved to the trash");
    expect(notTrashedText(2)).toBe("2 files were not moved to the trash");
  });

  it("asks before a large trash by the folder or the count", () => {
    expect(moveManyTitle(5000, "outputs/text")).toBe(
      "Move all 5,000 files in outputs/text to the trash?",
    );
    expect(moveManyTitle(120, null)).toBe("Move 120 files to the trash?");
  });

  it("says what came back under another name and what stayed behind", () => {
    expect(restoredAsText([])).toBeNull();
    expect(restoredAsText(["00044 (restored).png"])).toBe(
      'Came back as "00044 (restored).png": another file has its name',
    );
    expect(restoredAsText(["a (restored).png", "b (restored).png"])).toBe(
      "2 came back under new names: other files have theirs",
    );
    expect(restoredWithoutText(["a.txt"])).toBe("Restored without a.txt");
    expect(restoredWithoutText(["a.txt", "a.json"])).toBe("Restored without a.txt and 1 more");
    expect(restoredWithoutText([])).toBeNull();
  });

  it("asks before Delete now, naming other users' files in the trash", () => {
    expect(deleteFilesNowTitle(1, "a.png", false)).toBe('Delete "a.png" now?');
    expect(deleteFilesNowTitle(3, "a.png", true)).toBe("Delete 3 files for everyone?");
    expect(deleteFilesNowText(false, 3, nobody)).toBe(
      "Files saved beside them under the same name, such as the .txt, go too. They cannot be brought back.",
    );
    expect(deleteFilesNowText(true, 3, nobody)).toBe("They cannot be brought back.");
    expect(deleteFilesNowText(true, 3, { count: 2, name: "bob" })).toBe(
      "bob deleted 2 of them. They cannot be brought back.",
    );
    expect(deleteFilesNowText(true, 3, { count: 3, name: null })).toBe(
      "Other users deleted them. They cannot be brought back.",
    );
    expect(deleteFilesNowText(false, 1, nobody)).toBe(
      "Files saved beside it under the same name, such as the .txt, go too. It cannot be brought back.",
    );
    expect(deleteFilesNowText(true, 1, { count: 1, name: "bob" })).toBe(
      "bob deleted it. It cannot be brought back.",
    );
  });

  it("states the Trash folder and asks before Empty", () => {
    expect(trashFolderText(412, 1.2 * GB, 7)).toBe("412 files · about 1.2 GB · kept for 7 days");
    expect(trashFolderText(0, 0, 1)).toBe("No files in the trash · kept for 1 day");
    expect(emptyGalleryTrashText(412, 1.2 * GB, { count: 120, name: "bob" })).toBe(
      "Delete all 412 files in the trash for everyone (120 deleted by bob)? About 1.2 GB is freed. They cannot be brought back.",
    );
    expect(emptyGalleryTrashText(1, 0, nobody)).toBe(
      "Delete the 1 file in the trash for everyone? It cannot be brought back.",
    );
  });

  it("words the panel lines and the search", () => {
    expect(wasInText("outputs/text/Qwen")).toBe("Was in outputs/text/Qwen");
    expect(hiddenBySearchText(2)).toBe("2 hidden by the search");
    expect(hiddenLeftText(1)).toBe("1 file hidden by the search was left");
    expect(hiddenLeftText(2)).toBe("2 files hidden by the search were left");
  });
});

describe("the Trash folder's lines and pickers", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const facts = {
    id: "0123456789abcdef",
    from: "outputs/text/Qwen",
    trashedAt: 0,
    trashedBy: "alice",
    expiresAt: 7 * DAY,
    bytes: 10,
    lost: false,
  };

  it("says where a file was, who deleted it, when, and how long it stays", () => {
    expect(trashLineText(facts, DAY)).toBe(
      "Was in outputs/text/Qwen · deleted by alice 1 day ago · 6 days left",
    );
    expect(trashLineText({ ...facts, trashedBy: null }, 8 * DAY)).toBe(
      "Was in outputs/text/Qwen · deleted 8 days ago · goes within 5 minutes",
    );
    expect(trashLineText({ ...facts, lost: true }, DAY)).toBe(
      "Was in outputs/text/Qwen · its file is missing from the trash",
    );
  });

  it("words the large trash and Restore to...", () => {
    expect(moveManyText(7)).toBe(
      "They and the files saved beside them stay in the trash for 7 days.",
    );
    expect(moveManyText(1)).toBe(
      "They and the files saved beside them stay in the trash for 1 day.",
    );
    expect(restoreToTitle(1)).toBe("Restore 1 file to...");
    expect(restoreToTitle(1200)).toBe("Restore 1,200 files to...");
  });
});

describe("a result's file in the trash", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("counts a batch's files in the trash, and the Library's files line", () => {
    expect(inTrashOfText(1, 4)).toBe("1 of 4 in the trash");
    expect(filesInTrashLineText(412, 1.2 * GB)).toBe(
      "412 files in the trash on the server · about 1.2 GB",
    );
    expect(filesInTrashLineText(0, 0)).toBe("No files in the trash");
  });

  it("says how long it stays", () => {
    expect(inTrashChipText(7 * DAY, DAY / 2)).toBe("In the trash · 6 days left");
    expect(inTrashChipText(DAY, DAY - 2 * 60 * 60 * 1000)).toBe("In the trash · 2 hours left");
    expect(inTrashChipText(DAY, DAY - 60 * 1000)).toBe("In the trash · 1 hour left");
    expect(inTrashChipText(DAY, 2 * DAY)).toBe("In the trash · goes within 5 minutes");
  });
});

describe("fileStateText, fileStateLabel and fileTrashReason", () => {
  const trashed = { state: "trashed", item: "i", expiresAt: 9 } as const;
  const gone = { state: "gone" } as const;

  it("says where a result's file went, and nothing while it stayed", () => {
    expect(fileStateText(trashed)).toBe("In the trash");
    expect(fileStateText(gone)).toBe("Deleted from the trash");
    expect(fileStateText(null)).toBeNull();
    expect(fileStateLabel(trashed)).toBe("In the trash");
    expect(fileStateLabel(gone)).toBe("Deleted");
    expect(fileStateLabel(null)).toBeNull();
  });

  it("lets the trash actions act only on a file in the trash", () => {
    expect(fileTrashReason(trashed)).toBeNull();
    expect(fileTrashReason(gone)).toBe("Deleted from the trash");
    expect(fileTrashReason(null)).toBe("Not in the trash");
  });
});
