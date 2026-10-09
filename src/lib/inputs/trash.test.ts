import { describe, expect, it } from "vitest";
import { frame, layer, picture } from "./frames.fixture";
import { splitEntry, splitRemoval, type Entry, type Removal } from "./stored";
import { byRemoval, entryItem, goingWith, removalItem, type TrashItem } from "./trash";
import { trashAgeText } from "./text";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const removal = (content: Removal["content"], patch: Partial<Removal> = {}): Removal => ({
  removedAt: 1000,
  cause: "removed",
  size: { width: 640, height: 448 },
  from: { position: 2, frameId: "f", role: "initial" },
  content,
  ...patch,
});

const itemOf = (r: Removal) => removalItem("k", splitRemoval(r).record, WEEK);

const painted = () => ({
  ...frame("f", "initial", layer("a"), layer("b")),
  mask: {
    objects: [],
    strokes: [{ points: [0, 0, 4, 4], strokeWidth: 8, tool: "brush" as const }],
  },
});

describe("removalItem", () => {
  it("names a removed frame by its place, role and pictures", () => {
    const refs = frame("f", "reference", picture("a"), picture("b"), picture("c"));
    const content = { kind: "frame" as const, index: 1, frame: refs, linkedFrom: [] };
    expect(itemOf(removal(content)).title).toBe("Input 2 (Reference, 3 pictures)");
  });

  it("names a removed picture by its file and the frame it left", () => {
    const content = { kind: "picture" as const, index: 0, picture: picture("cat") };
    expect(itemOf(removal(content)).title).toBe("cat.png, from Input 2");
  });

  it("says whether a frame's content was cleared or replaced", () => {
    const content = { kind: "contents" as const, frame: painted() };
    expect(itemOf(removal(content, { cause: "cleared" })).title).toBe(
      "Cleared from Input 2: 2 layers, mask",
    );
    expect(itemOf(removal(content, { cause: "replaced" })).title).toBe(
      "Replaced in Input 2: 2 layers, mask",
    );
  });

  it("says whether the whole list was cleared or replaced", () => {
    const frames = [painted(), frame("g", "reference", picture("c"))];
    const content = { kind: "frames" as const, frames, sizeSource: null };
    expect(itemOf(removal(content, { cause: "cleared" })).title).toBe("Cleared inputs (2 inputs)");
    expect(itemOf(removal(content, { cause: "replaced" })).title).toBe(
      "Replaced inputs (2 inputs)",
    );
  });

  it("shows the first picture it held and goes the trash's time after it left", () => {
    const frames = [frame("e", "initial"), frame("g", "reference", picture("c"), picture("d"))];
    const item = itemOf(removal({ kind: "frames", frames, sizeSource: null }));
    expect(item.thumb?.cid).toBe("cid-c");
    expect(item.expiresAt).toBe(1000 + WEEK);
    expect(item).toMatchObject({ id: "removal:k", source: "removal", key: "k", removedAt: 1000 });
  });
});

describe("entryItem", () => {
  const entry = (patch: Partial<Entry> = {}): Entry => ({
    id: "e1",
    kind: "set",
    name: "Portrait",
    savedAt: 500,
    usedAt: 600,
    pinned: false,
    trashedAt: 2000,
    inputs: {
      size: { width: 640, height: 448 },
      sizeSource: null,
      frames: [frame("f", "initial", layer("a")), frame("g", "reference", picture("b"))],
    },
    maps: {},
    ...patch,
  });
  const itemOf = (e: Entry) => entryItem({ ...splitEntry(e).record, trashedAt: 2000 }, WEEK);

  it("names a set by its name and how many inputs it holds", () => {
    expect(itemOf(entry()).title).toBe('"Portrait", from the library (set, 2 inputs)');
  });

  it("names a frame by its name and role", () => {
    const frames = [frame("g", "reference", picture("b"))];
    const size = { width: 640, height: 448 };
    const one = entry({ kind: "frame", inputs: { size, sizeSource: null, frames } });
    expect(itemOf(one).title).toBe('"Portrait", from the library (Reference frame)');
  });

  it("goes the trash's time after it left the library", () => {
    expect(itemOf(entry())).toMatchObject({
      id: "entry:e1",
      source: "entry",
      key: "e1",
      removedAt: 2000,
      expiresAt: 2000 + WEEK,
    });
    expect(itemOf(entry()).thumb?.cid).toBe("cid-a");
  });
});

describe("the trash's order and what goes", () => {
  const at = (id: string, removedAt: number) => ({ id, removedAt }) as TrashItem;

  it("lists the newest first, and by id when two left at once", () => {
    const sorted = [at("a", 1), at("c", 3), at("b", 3)].sort(byRemoval).map((i) => i.id);
    expect(sorted).toEqual(["b", "c", "a"]);
  });

  it("counts what a shorter time would let go at the next start", () => {
    const now = 10 * DAY;
    const items = [at("a", now - 3 * DAY), at("b", now - DAY), at("c", now - HOUR)];
    expect(goingWith(items, 2 * DAY, now)).toBe(1);
    expect(goingWith(items, DAY, now)).toBe(2);
    expect(goingWith(items, WEEK, now)).toBe(0);
  });
});

describe("trashAgeText", () => {
  it("says how long ago it left and how long it stays", () => {
    expect(trashAgeText(0, WEEK, 30_000)).toBe("removed just now · 6 days left");
    expect(trashAgeText(0, WEEK, 3 * HOUR)).toBe("removed 3 h ago · 6 days left");
    expect(trashAgeText(0, DAY, 19 * HOUR)).toBe("removed 19 h ago · 5 hours left");
    expect(trashAgeText(0, DAY, DAY - 1000)).toBe("removed 23 h ago · 1 hour left");
  });

  it("says it goes at the next start once its time has passed", () => {
    expect(trashAgeText(0, DAY, 2 * DAY)).toBe("removed 2 days ago · goes at the next start");
  });
});
