import { describe, expect, it } from "vitest";
import { hashOf, isHash } from "./hash";

const HASH = "0123456789abcdef".repeat(4);

describe("isHash", () => {
  it("takes 64 lowercase hex and nothing else", () => {
    expect(isHash(HASH)).toBe(true);
    for (const value of [
      HASH.toUpperCase(),
      HASH.slice(1),
      `${HASH}0`,
      `../../${HASH.slice(6)}`,
      "",
      null,
      64,
    ]) {
      expect(isHash(value)).toBe(false);
    }
  });
});

describe("hashOf", () => {
  it("answers a cid's own well-formed hash", () => {
    expect(hashOf({ c1: HASH }, "c1")).toBe(HASH);
    expect(hashOf({ c1: "../../jobs" }, "c1")).toBeNull();
    expect(hashOf({ c1: HASH }, "c2")).toBeNull();
  });

  it("finds nothing for a cid named like an inherited key", () => {
    for (const cid of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
      expect(hashOf({ c1: HASH }, cid)).toBeNull();
    }
  });

  it("answers a hash the server sent under such a name", () => {
    const sent = JSON.parse(`{"__proto__": "${HASH}", "constructor": "${HASH}"}`) as Record<
      string,
      unknown
    >;
    expect(hashOf(sent, "__proto__")).toBe(HASH);
    expect(hashOf(sent, "constructor")).toBe(HASH);
  });
});
