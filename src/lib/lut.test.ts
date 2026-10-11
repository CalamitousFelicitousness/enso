import { describe, expect, it } from "vitest";
import {
  acceptHash,
  legacyLutPair,
  lutBytes,
  lutDropped,
  lutState,
  migratePendingLuts,
  NO_LUT,
  stageLut,
  type PendingLut,
} from "./lut";

const HASH = "a".repeat(64);
const OTHER = "b".repeat(64);
const file = new Blob(["LUT_3D_SIZE 2"]);
/** A pick the server has not answered for yet. */
const pending: PendingLut = { name: "grade.cube", file };
/** The same bytes once the server answered for them. */
const hashed: PendingLut = { name: "grade.cube", file, hash: HASH };

describe("lutBytes", () => {
  it("takes bytes known to have the pair's hash, whatever their name", () => {
    expect(lutBytes({ name: "grade.cube", hash: HASH }, hashed)).toBe(file);
    expect(lutBytes({ name: "Color LUT (restored)", hash: HASH }, hashed)).toBe(file);
  });

  it("never takes bytes of another or an unknown hash for a pair with one", () => {
    expect(lutBytes({ name: "grade.cube", hash: OTHER }, hashed)).toBeNull();
    // a restore names every LUT alike, so a name proves nothing once there is a hash
    expect(lutBytes({ name: "grade.cube", hash: HASH }, pending)).toBeNull();
  });

  it("takes a pick under the pair's name while the pair has no hash", () => {
    expect(lutBytes({ name: "grade.cube", hash: null }, pending)).toBe(file);
    expect(lutBytes({ name: "warm.cube", hash: null }, pending)).toBeNull();
    // bytes that went out under another hash are not a pick
    expect(lutBytes({ name: "grade.cube", hash: null }, hashed)).toBeNull();
    expect(lutBytes(NO_LUT, pending)).toBeNull();
  });
});

describe("stageLut", () => {
  it("sends nothing for no LUT", () => {
    expect(stageLut(NO_LUT, pending)).toEqual({ kind: "none" });
  });

  it("claims the hash first, with the bytes when they are the pair's", () => {
    expect(stageLut({ name: "grade.cube", hash: HASH }, hashed)).toEqual({
      kind: "stage",
      hash: HASH,
      bytes: file,
    });
    expect(stageLut({ name: "grade.cube", hash: HASH }, null)).toEqual({
      kind: "stage",
      hash: HASH,
      bytes: null,
    });
  });

  it("never sends another LUT's bytes", () => {
    const other: PendingLut = { name: "warm.cube", file };
    expect(stageLut({ name: "grade.cube", hash: HASH }, other)).toEqual({
      kind: "stage",
      hash: HASH,
      bytes: null,
    });
    expect(stageLut({ name: "grade.cube", hash: null }, other)).toEqual({ kind: "pickAgain" });
  });

  it("sends the bytes of a LUT the server has not answered for yet", () => {
    expect(stageLut({ name: "grade.cube", hash: null }, pending)).toEqual({
      kind: "stage",
      hash: null,
      bytes: file,
    });
    expect(stageLut({ name: "grade.cube", hash: null }, null)).toEqual({ kind: "pickAgain" });
  });
});

describe("lutState", () => {
  const pair = { name: "grade.cube", hash: HASH };

  it("is ready while the bytes are here", () => {
    expect(lutState(pair, hashed, "missing")).toEqual({ kind: "ready", name: "grade.cube" });
  });

  it("asks the server, then fetches back, asks for a new pick, or says it could not ask", () => {
    expect(lutState(pair, null, "unchecked")).toEqual({ kind: "checking", name: "grade.cube" });
    expect(lutState(pair, null, "present")).toEqual({ kind: "held", name: "grade.cube" });
    expect(lutState(pair, null, "missing")).toEqual({ kind: "pickAgain", name: "grade.cube" });
    expect(lutState(pair, null, "failed")).toEqual({ kind: "unverified", name: "grade.cube" });
  });

  it("asks for a new pick when neither the bytes nor a hash are known", () => {
    expect(lutState({ name: "grade.cube", hash: null }, null, "unchecked")).toEqual({
      kind: "pickAgain",
      name: "grade.cube",
    });
    expect(lutState(NO_LUT, pending, "present")).toEqual({ kind: "none" });
  });
});

describe("acceptHash", () => {
  const pair = { name: "grade.cube", hash: null };

  it("writes the hash the server answered into the pair and the bytes staged", () => {
    expect(acceptHash(pair, pending, pending, HASH)).toEqual({
      pair: { name: "grade.cube", hash: HASH },
      pending: hashed,
    });
  });

  it("writes nothing once another pick or a restore moved the pair on, or nothing changes", () => {
    const repicked: PendingLut = { name: "grade.cube", file: new Blob(["other"]) };
    expect(acceptHash(pair, repicked, pending, HASH)).toBeNull();
    expect(acceptHash({ name: "warm.cube", hash: OTHER }, pending, pending, HASH)).toBeNull();
    expect(
      acceptHash({ name: "Color LUT (restored)", hash: OTHER }, hashed, hashed, HASH),
    ).toBeNull();
    expect(acceptHash({ name: "grade.cube", hash: HASH }, hashed, hashed, HASH)).toBeNull();
  });
});

describe("legacyLutPair", () => {
  it("keeps the hash of an older build's ref and names it from that build", () => {
    expect(legacyLutPair(`upload:${HASH}`)).toEqual({
      name: "LUT from an earlier version",
      hash: HASH,
    });
  });

  it("asks for a new pick for a ref from before the store, and nothing for none", () => {
    expect(legacyLutPair("upload:0123456789abcdef")).toEqual({
      name: "LUT from an earlier version",
      hash: null,
    });
    expect(legacyLutPair("")).toBeNull();
    expect(legacyLutPair(undefined)).toBeNull();
  });
});

describe("migratePendingLuts", () => {
  it("keeps the Color tab's file of a version 1 record under its own name", () => {
    const picked = new File(["LUT_3D_SIZE 2"], "warm.cube");
    expect(migratePendingLuts({ file: picked }, 1)).toEqual({
      images: { name: "warm.cube", file: picked },
      process: null,
    });
    expect(migratePendingLuts({ file: null }, 1)).toEqual({ images: null, process: null });
  });

  it("reads a version 2 record as it is", () => {
    const stored = { images: null, process: pending };
    expect(migratePendingLuts(stored, 2)).toBe(stored);
  });
});

describe("lutDropped", () => {
  const sent = { grading: { lut_cube_file: `upload:${HASH}` } };

  it("is true when a job sent a LUT its result does not name", () => {
    expect(lutDropped(sent, "Steps: 1")).toBe(true);
  });

  it("is false for a run that processed no image", () => {
    expect(lutDropped(sent, "")).toBe(false);
    expect(lutDropped(sent, null)).toBe(false);
  });

  it("is false when the result names it or none was sent", () => {
    expect(lutDropped(sent, "Grading lut cube file: grade.cube")).toBe(false);
    expect(lutDropped({ grading: { lut_cube_file: "" } }, null)).toBe(false);
    expect(lutDropped({ type: "process" }, null)).toBe(false);
    expect(lutDropped(null, null)).toBe(false);
  });
});
