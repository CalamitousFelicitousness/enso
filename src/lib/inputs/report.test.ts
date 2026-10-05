import { describe, expect, it } from "vitest";
import { addToReport, reportLines, type InputReport } from "./report";

const none = { pictures: [], maskObjects: 0 };

describe("addToReport", () => {
  it("is null while there is nothing to tell", () => {
    expect(addToReport(null, {})).toBeNull();
    expect(addToReport(null, { lost: none, notes: [], legacyUnread: false })).toBeNull();
  });

  it("adds to what is already reported", () => {
    const first = addToReport(null, {
      lost: { pictures: [{ frameId: "f", name: "a.png" }], maskObjects: 1 },
    });
    const both = addToReport(first, {
      lost: { pictures: [{ frameId: "g", name: "b.png" }], maskObjects: 2 },
      notes: [{ kind: "skipped", position: 1, count: 1 }],
      legacyUnread: true,
    });
    expect(both).toEqual({
      lost: {
        pictures: [
          { frameId: "f", name: "a.png" },
          { frameId: "g", name: "b.png" },
        ],
        maskObjects: 3,
      },
      notes: [{ kind: "skipped", position: 1, count: 1 }],
      legacyUnread: true,
    });
  });
});

describe("reportLines", () => {
  it("says what happened, frame by frame", () => {
    const report: InputReport = {
      lost: {
        pictures: [
          { frameId: "f", name: "a.png" },
          { frameId: "gone", name: "b.png" },
        ],
        maskObjects: 1,
      },
      notes: [
        { kind: "otherMode", position: 1, count: 2 },
        { kind: "unreadablePicture", position: 2, name: "c.png" },
        { kind: "unreadableMask", position: 2, count: 3 },
        { kind: "skipped", position: 3, count: 1 },
      ],
      legacyUnread: true,
    };
    expect(reportLines(report, (id) => (id === "f" ? 2 : null))).toEqual([
      '"a.png" in Input 2 could not be read. Replace or remove it.',
      '"b.png" could not be read. Replace or remove it.',
      "1 mask could not be read and was left out.",
      "Input 1: 2 pictures from its other mode are kept hidden and not sent.",
      'Input 2: "c.png" could not be read. Replace or remove it.',
      "Input 2: 3 masks could not be read and were left out.",
      "Input 3: 1 item this version does not know was left out.",
      "Inputs saved by an earlier version could not be read. They will be tried again the next time the page loads.",
    ]);
  });
});
