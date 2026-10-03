import { describe, expect, it } from "vitest";
import type { UnifiedModel } from "@/api/types/cloud";
import { followsLoaded } from "./modelSelection";

const local = (title: string) => ({ source: "local", title }) as UnifiedModel;
const cloud = { source: "cloud", name: "remote" } as UnifiedModel;
const video = { source: "local-video", title: "wan" } as UnifiedModel;

describe("followsLoaded", () => {
  it("takes the loaded model when nothing is selected", () => {
    expect(followsLoaded("klein", undefined, null)).toBe(true);
  });

  it("drops a stored selection when the page first learns what is loaded", () => {
    expect(followsLoaded("klein", undefined, local("qwen"))).toBe(true);
    expect(followsLoaded("klein", undefined, local("klein"))).toBe(false);
  });

  it("keeps a pick while the loaded model stays the same", () => {
    expect(followsLoaded("klein", "klein", local("qwen"))).toBe(false);
  });

  it("stays put when the pick is what got loaded", () => {
    expect(followsLoaded("qwen", "klein", local("qwen"))).toBe(false);
  });

  it("follows a model loaded from elsewhere, also over a pending pick", () => {
    expect(followsLoaded("sdxl", "klein", local("klein"))).toBe(true);
    expect(followsLoaded("sdxl", "klein", local("qwen"))).toBe(true);
    expect(followsLoaded("sdxl", null, local("qwen"))).toBe(true);
  });

  it("keeps the selection while nothing is loaded", () => {
    expect(followsLoaded(null, "klein", local("klein"))).toBe(false);
    expect(followsLoaded(null, undefined, local("qwen"))).toBe(false);
  });

  it("leaves cloud and video selections alone", () => {
    expect(followsLoaded("sdxl", "klein", cloud)).toBe(false);
    expect(followsLoaded("sdxl", undefined, video)).toBe(false);
  });
});
