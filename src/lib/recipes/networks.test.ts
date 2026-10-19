import { describe, expect, it } from "vitest";
import { networkTags, networksIn, PARTIAL_TAG } from "./networks";

describe("networkTags", () => {
  it("reads sdnext's tags with their weights and spans", () => {
    const text = "a <lora:fur:0.8> <lyco:b> <LORA:c d:0.5:0.3> <lora:open";
    expect(networkTags(text)).toEqual([
      { kind: "lora", name: "fur", weights: ["0.8"], from: 2, to: 16 },
      { kind: "lyco", name: "b", weights: [], from: 17, to: 25 },
      { kind: "lora", name: "c d", weights: ["0.5", "0.3"], from: 26, to: 44 },
    ]);
  });

  it("leaves other tags alone", () => {
    expect(networkTags("<style:x> <hypernet:y:1> __wild__")).toEqual([]);
  });
});

describe("networksIn", () => {
  it("names each network once across texts, in the order met", () => {
    expect(networksIn("<lora:a:1> <lora:a:0.5> <lyco:a>", "<lora:b>")).toEqual([
      { kind: "lora", name: "a" },
      { kind: "lyco", name: "a" },
      { kind: "lora", name: "b" },
    ]);
  });
});

describe("PARTIAL_TAG", () => {
  it("matches an unclosed tag with any name characters", () => {
    expect("<lora:Pony (v2) it's".match(PARTIAL_TAG)?.[0]).toBe("<lora:Pony (v2) it's");
    expect("<lora:a:0.5".match(new RegExp(`${PARTIAL_TAG.source}$`, "i"))).toBeNull();
  });
});
