import { describe, expect, it } from "vitest";
import { ENTRY_MIME, IMAGE_MIME, mimeOf, readPayload, type DragPayload } from "./drag";

describe("drag payloads", () => {
  const payloads: DragPayload[] = [
    { type: "result-image", resultId: "r", imageIndex: 2, src: "/x.png" },
    { type: "gallery-image", filePath: "/a/b.png", fileId: "f", src: undefined },
    { type: "library-entry", entryId: "e", src: "blob:1" },
  ];

  it("reads every kind back as it was sent", () => {
    for (const payload of payloads) {
      expect(readPayload(JSON.stringify(payload))).toEqual(payload);
    }
  });

  it("sends an entry under its own type and pictures under theirs", () => {
    expect(payloads.map(mimeOf)).toEqual([IMAGE_MIME, IMAGE_MIME, ENTRY_MIME]);
  });

  it("refuses what is not a payload", () => {
    expect(readPayload("")).toBeNull();
    expect(readPayload("not json")).toBeNull();
    expect(readPayload(JSON.stringify({ type: "result-image", resultId: "r" }))).toBeNull();
    expect(readPayload(JSON.stringify({ type: "library-entry" }))).toBeNull();
    expect(readPayload(JSON.stringify({ type: "folder", path: "/" }))).toBeNull();
    expect(readPayload(JSON.stringify(["result-image"]))).toBeNull();
  });
});
