import { describe, expect, it } from "vitest";
import { frame, layer, picture } from "./frames.fixture";
import {
  byUse,
  defaultEntryName,
  entryThumbs,
  LIBRARY_CAP,
  listOrder,
  overCap,
  pinned,
  type EntryFacts,
} from "./library";
import { newFrame } from "./reducers";
import { DOCUMENT_SCHEMA, splitFrames } from "./stored";
import { libraryCountText } from "./text";
import type { Frame } from "./types";

const facts = (id: string, usedAt: number, patch: Partial<EntryFacts> = {}): EntryFacts => ({
  id,
  pinned: false,
  usedAt,
  savedAt: usedAt,
  trashedAt: null,
  ...patch,
});

describe("overCap", () => {
  it("lets the least recently used unpinned entries go past the cap and never a pinned one", () => {
    const entries = Array.from({ length: LIBRARY_CAP + 2 }, (_, i) => facts(`e${i}`, i));
    entries.push(facts("old-pin", -5, { pinned: true }));
    expect(overCap(entries)).toEqual(["e0", "e1"]);
  });

  it("keeps every entry under the cap, pins and trashed entries not counted", () => {
    const entries = Array.from({ length: LIBRARY_CAP }, (_, i) => facts(`e${i}`, i));
    entries.push(facts("pin", 0, { pinned: true }), facts("gone", 0, { trashedAt: 9 }));
    expect(overCap(entries)).toEqual([]);
  });

  it("lets the one saved earlier go when two were used at the same time", () => {
    const entries = Array.from({ length: LIBRARY_CAP - 1 }, (_, i) => facts(`e${i}`, 100 + i));
    entries.push(facts("later", 5, { savedAt: 2 }), facts("earlier", 5, { savedAt: 1 }));
    expect(overCap(entries)).toEqual(["earlier"]);
  });
});

describe("the library's order", () => {
  it("lists pinned entries first, then the most recently used", () => {
    const list = [facts("a", 1), facts("b", 3), facts("p", 0, { pinned: true }), facts("c", 2)];
    expect([...list].sort(listOrder).map((e) => e.id)).toEqual(["p", "b", "c", "a"]);
    expect([...list].sort(byUse).map((e) => e.id)).toEqual(["b", "c", "a", "p"]);
  });

  it("counts the pinned entries still in the library", () => {
    expect(
      pinned([facts("a", 0, { pinned: true }), facts("b", 0, { pinned: true, trashedAt: 1 })]),
    ).toHaveLength(1);
  });
});

describe("defaultEntryName", () => {
  const now = Date.UTC(2026, 9, 8, 13, 5);

  it("names a frame after its first picture without the extension", () => {
    const named = frame("f", "reference", picture("a", { name: "cat photo.final.png" }));
    expect(defaultEntryName("frame", named, 2, now, "UTC")).toBe("cat photo.final");
  });

  it("names a frame without pictures by its place and role", () => {
    const control = { ...newFrame("f", "control"), control: newFrame("f", "control").control };
    expect(defaultEntryName("frame", control, 3, now, "UTC")).toBe("Input 3 (ControlNet)");
  });

  it("names a set after when it was saved, in the time zone given", () => {
    const any = frame("f", "initial");
    expect(defaultEntryName("set", any, 1, now, "UTC")).toBe("Inputs 2026-10-08 13:05");
    expect(defaultEntryName("set", any, 1, now, "Asia/Tokyo")).toBe("Inputs 2026-10-08 22:05");
  });
});

describe("entryThumbs", () => {
  const thumbs = (kind: "frame" | "set", frames: Frame[]) => {
    const inputs = {
      schema: DOCUMENT_SCHEMA,
      size: { width: 64, height: 64 },
      sizeSource: null,
      frames: splitFrames(frames).frames,
    };
    const { pictures, more } = entryThumbs({ kind, inputs });
    return { cids: pictures.map((p) => p.cid), more };
  };

  it("shows each input's first picture for a set, four at most, and counts the rest", () => {
    const frames = ["a", "b", "c", "d", "e", "f"].map((id) =>
      frame(id, "reference", picture(id), picture(`${id}2`)),
    );
    expect(thumbs("set", frames)).toEqual({ cids: ["cid-a", "cid-b", "cid-c", "cid-d"], more: 2 });
  });

  it("shows a composed frame's bottom layer and counts the layers above it", () => {
    const frames = [frame("f", "initial", layer("a"), layer("b"), layer("c"))];
    expect(thumbs("frame", frames)).toEqual({ cids: ["cid-a"], more: 2 });
  });

  it("shows up to four pictures of a frame that sends each one", () => {
    const frames = [frame("f", "reference", ...["a", "b", "c", "d", "e"].map((id) => picture(id)))];
    expect(thumbs("frame", frames)).toEqual({
      cids: ["cid-a", "cid-b", "cid-c", "cid-d"],
      more: 1,
    });
  });
});

describe("libraryCountText", () => {
  it("counts the entries the cap applies to, and the pins beside them", () => {
    expect(libraryCountText(38, LIBRARY_CAP, 4)).toBe("38 of 100 · 4 pinned");
    expect(libraryCountText(38, LIBRARY_CAP, 0)).toBe("38 of 100");
  });
});
