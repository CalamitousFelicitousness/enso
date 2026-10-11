import { describe, expect, it } from "vitest";
import { frame, layer, picture } from "@/lib/inputs/frames.fixture";
import { DOCUMENT_SCHEMA, storedInputsOf } from "@/lib/inputs/stored";
import {
  assembleEntry,
  clampName,
  entryMore,
  entrySummary,
  isNewerEntry,
  NAME_MAX,
  shapeOfItem,
  type EntryParts,
} from "./entry";

const inputs = storedInputsOf({
  size: { width: 640, height: 448 },
  sizeSource: null,
  frames: [frame("f", "initial", layer("a"), layer("b")), frame("g", "reference", picture("c"))],
});

const parts = (patch: Partial<EntryParts> = {}): EntryParts => ({
  id: "e1",
  kind: "set",
  name: "  Portrait  ",
  inputs,
  inputCids: ["cid-a", "cid-b", "cid-c"],
  maps: { k1: "m1", k2: "m2" },
  hashes: new Map([
    ["cid-a", "ha"],
    ["cid-c", "hc"],
    ["m1", "hm1"],
  ]),
  thumbs: [
    { cid: "cid-a", thumb: "ta", width: 64, height: 64 },
    { cid: "cid-b", thumb: "tb", width: 64, height: 64 },
  ],
  ...patch,
});

describe("assembleEntry", () => {
  it("pairs each picture with its hash and declares the rest unavailable", () => {
    const body = assembleEntry(parts());
    expect(body.hashes).toEqual({ "cid-a": "ha", "cid-c": "hc", m1: "hm1" });
    expect(body.unavailable).toEqual(["cid-b"]);
  });

  it("leaves out a map whose bytes did not get there, and a thumbnail without its picture", () => {
    const body = assembleEntry(parts());
    expect(body.maps).toEqual({ k1: "m1" });
    expect(body.thumbs).toEqual([{ cid: "cid-a", hash: "ha", thumb: "ta", width: 64, height: 64 }]);
  });

  it("trims and clamps the name, and copies the inputs", () => {
    const body = assembleEntry(parts({ name: `  ${"x".repeat(NAME_MAX + 50)}  ` }));
    expect([...body.name]).toHaveLength(NAME_MAX);
    expect(body.inputs).toEqual(inputs);
    expect(body.inputs).not.toBe(inputs);
    expect(assembleEntry(parts()).name).toBe("Portrait");
  });

  it("carries an older build's times and pin when the entry moves", () => {
    const moved = assembleEntry(
      parts({ moved: { savedAt: 1, usedAt: 2, pinned: true, trashedAt: 3 } }),
    );
    expect(moved).toMatchObject({
      migrating: true,
      saved_at: 1,
      used_at: 2,
      pinned: true,
      trashed_at: 3,
    });
    expect(assembleEntry(parts())).not.toHaveProperty("migrating");
  });
});

describe("entrySummary", () => {
  it("counts a set's frames and pictures at the document's frame size", () => {
    expect(entrySummary("set", inputs)).toEqual({
      frames: 2,
      pictures: 3,
      role: null,
      control: null,
      width: 640,
      height: 448,
      inputs_schema: DOCUMENT_SCHEMA,
    });
  });

  it("names a frame entry's role", () => {
    const one = storedInputsOf({
      size: { width: 64, height: 64 },
      sizeSource: null,
      frames: [frame("g", "reference", picture("c"), picture("d"))],
    });
    expect(entrySummary("frame", one)).toMatchObject({
      frames: 1,
      pictures: 2,
      role: "reference",
      control: null,
    });
  });
});

describe("a card's facts", () => {
  const item = { kind: "frame", frames: 1, pictures: 3, thumbs: [{}] } as never;

  it("counts the pictures a card does not show", () => {
    expect(entryMore(item)).toBe(2);
    expect(entryMore({ kind: "set", frames: 6, pictures: 9, thumbs: [] })).toBe(2);
    expect(entryMore({ kind: "set", frames: 3, pictures: 9, thumbs: [] })).toBe(0);
  });

  it("tells an entry a newer build saved", () => {
    expect(isNewerEntry({ inputs_schema: DOCUMENT_SCHEMA })).toBe(false);
    expect(isNewerEntry({ inputs_schema: DOCUMENT_SCHEMA + 1 })).toBe(true);
  });

  it("says what an entry holds from the server's counts", () => {
    const shape = shapeOfItem({
      kind: "frame",
      frames: 1,
      pictures: 2,
      role: "control",
      control: "controlnet",
      width: 64,
      height: 32,
    });
    expect(shape).toEqual({
      kind: "frame",
      frames: 1,
      pictures: 2,
      roleLabel: "ControlNet",
      size: { width: 64, height: 32 },
    });
    expect(
      shapeOfItem({ kind: "set", frames: 2, pictures: 5, role: null, width: 1, height: 1 })
        .roleLabel,
    ).toBeNull();
    // a role this build does not know keeps the server's name
    expect(
      shapeOfItem({ kind: "frame", frames: 1, pictures: 1, role: "audio", width: 1, height: 1 })
        .roleLabel,
    ).toBe("audio");
  });
});

describe("clampName", () => {
  it("counts characters, not code units", () => {
    expect([...clampName("🙂".repeat(NAME_MAX + 1))]).toHaveLength(NAME_MAX);
  });
});
