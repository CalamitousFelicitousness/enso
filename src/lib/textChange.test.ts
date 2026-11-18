import { describe, expect, it } from "vitest";
import { textChange, type TextChange } from "./textChange";

const apply = (text: string, change: TextChange | null) =>
  change ? text.slice(0, change.from) + change.insert + text.slice(change.to) : text;

describe("textChange", () => {
  it("replaces only what differs", () => {
    expect(textChange("a cat, dog", "a cat, red dog")).toEqual({ from: 7, to: 7, insert: "red " });
    expect(textChange("a cat, dog", "a dog")).toEqual({ from: 2, to: 7, insert: "" });
    expect(textChange("same", "same")).toBeNull();
  });

  it("does not let the common start and end overlap on a repeat", () => {
    const change = textChange("aa", "aaa");
    expect(change).toEqual({ from: 2, to: 2, insert: "a" });
    expect(apply("aa", change)).toBe("aaa");
  });

  it("keeps surrogate pairs whole", () => {
    const before = "a\u{1F600}b";
    const after = "a\u{1F601}b";
    const change = textChange(before, after);
    expect(change).toEqual({ from: 1, to: 3, insert: "\u{1F601}" });
    expect(apply(before, change)).toBe(after);
  });

  it("turns any text into any other", () => {
    const pairs: [string, string][] = [
      ["", "abc"],
      ["abc", ""],
      ["abcabc", "abc"],
      ["x\u{1F600}\u{1F600}", "x\u{1F600}"],
      ["(cat:1.20)", "(cat:1.25)"],
    ];
    for (const [before, after] of pairs)
      expect(apply(before, textChange(before, after))).toBe(after);
  });
});
