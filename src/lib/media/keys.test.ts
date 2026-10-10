import { describe, expect, it } from "vitest";
import { layer } from "@/lib/inputs/frames.fixture";
import type { PlacedPicture } from "@/lib/inputs/types";
import { compositeKey, mapSendKey } from "./keys";

const FRAME = { width: 1024, height: 1024 };
const placed = (patch: Parameters<typeof layer>[1] = {}) => layer("a", patch) as PlacedPicture;
const key = (layers: PlacedPicture[], drawnAt = FRAME, encode = null) =>
  compositeKey(layers, FRAME, drawnAt, encode);

describe("compositeKey", () => {
  const base = key([placed()]);

  it("changes with a move smaller than a map key's quantum", () => {
    const moved = placed({ transform: { x: 0.001, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } });
    expect(key([moved])).not.toBe(base);
  });

  it("changes with a layer's size, opacity or visibility, and with the order of layers", () => {
    expect(key([placed({ width: 65 })])).not.toBe(base);
    expect(key([placed({ opacity: 0.5 })])).not.toBe(base);
    expect(key([placed({ visible: false })])).not.toBe(base);
    const b = layer("b", { cid: "cid-b" }) as PlacedPicture;
    expect(key([placed(), b])).not.toBe(key([b, placed()]));
  });

  it("changes with the size drawn at and the provider encoding", () => {
    expect(key([placed()], { width: 512, height: 512 })).not.toBe(base);
    expect(compositeKey([placed()], FRAME, FRAME, { provider: "nanogpt", model: "m" })).not.toBe(
      base,
    );
  });

  it("does not change with what the flatten never reads", () => {
    expect(key([placed({ id: "other", name: "renamed.png", locked: true })])).toBe(base);
    expect(key([placed({ file: new Blob(["other bytes object"]) })])).toBe(base);
  });
});

describe("mapSendKey", () => {
  it("names a map by its key, the size it is sent at and its encoding", () => {
    const plain = mapSendKey("canny|k", null, null);
    expect(mapSendKey("canny|k", { width: 64, height: 64 }, null)).not.toBe(plain);
    expect(mapSendKey("canny|k", null, { provider: "p", model: "m" })).not.toBe(plain);
    expect(mapSendKey("canny|k", null, null)).toBe(plain);
  });
});
