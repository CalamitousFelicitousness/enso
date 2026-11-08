import { describe, expect, it } from "vitest";
import { MAX_AGE_MS, outdated } from "./freshness";

const now = 1_000_000_000;
const fresh = { key: "r1", cachedAt: now - 1000 };
const aged = { key: "r1", cachedAt: now - MAX_AGE_MS - 1 };

describe("outdated", () => {
  it("follows the server's revision whatever the copy's age", () => {
    expect(outdated(aged, { key: "r1", exact: true }, now)).toBe(false);
    expect(outdated(fresh, { key: "r2", exact: true }, now)).toBe(true);
  });

  it("trusts a matching version for a day only", () => {
    expect(outdated(fresh, { key: "r1", exact: false }, now)).toBe(false);
    expect(outdated(aged, { key: "r1", exact: false }, now)).toBe(true);
    expect(outdated(fresh, { key: "v2", exact: false }, now)).toBe(true);
  });

  it("goes by age alone without a listing", () => {
    expect(outdated(fresh, undefined, now)).toBe(false);
    expect(outdated(aged, undefined, now)).toBe(true);
  });
});
