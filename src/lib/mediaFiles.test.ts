import { afterEach, describe, expect, it, vi } from "vitest";

async function load() {
  vi.resetModules();
  vi.stubGlobal("window", { location: { origin: "http://localhost:5174" } });
  return import("./mediaFiles");
}

describe("dispositionName", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads a plain filename, quoted or not", async () => {
    const { dispositionName } = await load();
    expect(dispositionName('inline; filename="00012-upscale.png"')).toBe("00012-upscale.png");
    expect(dispositionName("attachment; filename=out.mp4")).toBe("out.mp4");
  });

  it("prefers the encoded name a server sends for non-ASCII filenames", async () => {
    const { dispositionName } = await load();
    expect(dispositionName(`inline; filename="caf_.png"; filename*=utf-8''caf%C3%A9.png`)).toBe(
      "café.png",
    );
  });

  it("answers null without a header or a name", async () => {
    const { dispositionName } = await load();
    expect(dispositionName(null)).toBeNull();
    expect(dispositionName("inline")).toBeNull();
  });
});
