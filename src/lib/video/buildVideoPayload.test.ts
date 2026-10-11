import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoInput } from "./inputs";

let payload: typeof import("./buildVideoPayload");
let hashes: typeof import("@/stores/videoHashStore");

beforeEach(async () => {
  vi.resetModules();
  payload = await import("./buildVideoPayload");
  hashes = await import("@/stores/videoHashStore");
});

const HASH = "a".repeat(64);
const input = (id: string): VideoInput => ({ id, file: new File(["clip"], "clip.mp4") });

describe("videoInputOptions", () => {
  it("stages a canvas file under the hash the canvas keeps for it", () => {
    expect(payload.videoInputOptions(input("f1"))).not.toHaveProperty("hash");
    hashes.useVideoHashStore.getState().remember("f1", HASH);
    expect(payload.videoInputOptions(input("f1"))).toMatchObject({ name: "clip.mp4", hash: HASH });
  });

  it("keeps the hash the server answers for the file, by its frame", () => {
    const options = payload.videoInputOptions(input("f2"));
    options.onHash?.({ hash: HASH, size: 4 });
    expect(hashes.useVideoHashStore.getState().hashes).toEqual({ f2: HASH });
  });
});
