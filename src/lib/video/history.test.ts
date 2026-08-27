import { describe, expect, it } from "vitest";
import type { VideoResult } from "@/api/types/video";
import { evict } from "./history";

function row(id: string, pinned = false): VideoResult {
  return {
    id,
    videoUrl: `/sdapi/v2/outputs/${id}`,
    width: 1280,
    height: 720,
    format: "mp4",
    size: 1024,
    params: {},
    domain: "video",
    timestamp: 0,
    ...(pinned ? { pinned: true } : {}),
  };
}

const ids = (rows: VideoResult[]) => rows.map((r) => r.id);
const none: ReadonlySet<string> = new Set();

describe("evict", () => {
  it("keeps everything under the cap", () => {
    const { keep, drop } = evict([row("a"), row("b")], 5, none);
    expect(ids(keep)).toEqual(["a", "b"]);
    expect(drop).toEqual([]);
  });

  it("drops from the tail once the cap is reached", () => {
    const { keep, drop } = evict([row("a"), row("b"), row("c")], 2, none);
    expect(ids(keep)).toEqual(["a", "b"]);
    expect(drop).toEqual(["c"]);
  });

  it("keeps pinned rows above the cap without spending budget", () => {
    const rows = [row("a"), row("pin", true), row("b"), row("c")];
    const { keep, drop } = evict(rows, 2, none);
    expect(ids(keep)).toEqual(["a", "pin", "b"]);
    expect(drop).toEqual(["c"]);
  });

  it("keeps the rows the view points at", () => {
    const rows = [row("a"), row("b"), row("c"), row("d")];
    const { keep, drop } = evict(rows, 1, new Set(["c", "d"]));
    expect(ids(keep)).toEqual(["a", "c", "d"]);
    expect(drop).toEqual(["b"]);
  });

  it("drops everything evictable at a zero cap", () => {
    const rows = [row("a"), row("pin", true), row("b")];
    const { keep, drop } = evict(rows, 0, new Set(["b"]));
    expect(ids(keep)).toEqual(["pin", "b"]);
    expect(drop).toEqual(["a"]);
  });

  it("handles an empty history", () => {
    const { keep, drop } = evict([], 50, none);
    expect(keep).toEqual([]);
    expect(drop).toEqual([]);
  });
});
