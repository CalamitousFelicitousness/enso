import { describe, expect, it } from "vitest";
import { layer, picture } from "./frames.fixture";
import { completeParams, compositeSpec, fileSpec, mapKey, type PictureSpec } from "./freshness";
import type { JsonValue, PlacedPicture, ProcessorSpec } from "./types";

const canny: ProcessorSpec = { id: "Canny", params: { low_threshold: 50 } };
const FRAME = { width: 1024, height: 768 };
const key = (spec: PictureSpec, params: Record<string, JsonValue> = canny.params, revision = "1") =>
  mapKey(spec, canny, params, revision);

describe("mapKey", () => {
  it("is the same for the same content, whatever order the fields come in", () => {
    const a = key(fileSpec(picture("a")), { low_threshold: 50, high_threshold: 200 });
    const b = key(fileSpec(picture("a")), { high_threshold: 200, low_threshold: 50 });
    expect(a).toBe(b);
    expect(a).toBe(
      'Canny|1|{"high_threshold":200,"low_threshold":50}|{"cid":"cid-a","kind":"file"}',
    );
  });

  it("changes with the picture, a parameter, the processor or the runner", () => {
    const base = key(fileSpec(picture("a")));
    expect(key(fileSpec(picture("b")))).not.toBe(base);
    expect(key(fileSpec(picture("a")), { low_threshold: 51 })).not.toBe(base);
    expect(key(fileSpec(picture("a")), canny.params, "2")).not.toBe(base);
    expect(mapKey(fileSpec(picture("a")), { id: "HED", params: {} }, {}, "1")).not.toBe(base);
  });

  it("fills a processor's parameters from the server's defaults", () => {
    expect(completeParams(canny, { low_threshold: 100, high_threshold: 200 })).toEqual({
      low_threshold: 50,
      high_threshold: 200,
    });
    expect(completeParams(canny, undefined)).toEqual({ low_threshold: 50 });
  });
});

describe("compositeSpec", () => {
  const placed = (id: string, patch: Partial<PlacedPicture["transform"]> = {}, opacity = 1) =>
    layer(id, {
      opacity,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, ...patch },
    }) as PlacedPicture;

  it("keeps the layers in order with their placements", () => {
    const spec = compositeSpec(
      [placed("a"), placed("b", { x: 10, rotation: 90 }, 0.5)],
      FRAME,
      null,
    );
    expect(spec).toEqual({
      kind: "composite",
      width: 1024,
      height: 768,
      out: null,
      layers: [
        { cid: "cid-a", transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, opacity: 1 },
        {
          cid: "cid-b",
          transform: { x: 10, y: 0, scaleX: 1, scaleY: 1, rotation: 90 },
          opacity: 0.5,
        },
      ],
    });
  });

  it("quantises placements, so a refit that moves nothing visible changes no key", () => {
    const a = compositeSpec([placed("a", { x: 10.004, scaleX: 1.00004 })], FRAME, null);
    const b = compositeSpec([placed("a", { x: 9.996, scaleX: 0.99996 })], FRAME, null);
    expect(key(a)).toBe(key(b));
    const moved = compositeSpec([placed("a", { x: 10.02 })], FRAME, null);
    expect(key(moved)).not.toBe(key(a));
    const flipped = compositeSpec([placed("a", { x: -0.001 })], FRAME, null);
    expect(flipped.kind === "composite" && flipped.layers[0].transform.x).toBe(0);
  });

  it("records the size it is sent at only when that differs from the frame", () => {
    const same = compositeSpec([placed("a")], FRAME, { ...FRAME });
    expect(same.kind === "composite" && same.out).toBeNull();
    const resized = compositeSpec([placed("a")], FRAME, { width: 2048, height: 1536 });
    expect(resized.kind === "composite" && resized.out).toEqual({ width: 2048, height: 1536 });
    expect(key(resized)).not.toBe(key(same));
  });
});
