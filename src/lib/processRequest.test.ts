import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ProcessSections } from "@/stores/processStore";
import { activeSections, buildProcessPayload, type ProcessSettings } from "./processRequest";

let DEFAULT_SECTIONS: ProcessSections;

beforeAll(async () => {
  // the store's setters admit pictures through the door, whose API client reads the page's origin
  vi.stubGlobal("window", { location: { origin: "http://localhost:5174" } });
  ({ DEFAULT_SECTIONS } = await import("@/stores/processStore"));
});

function settings(overrides: Partial<ProcessSettings> = {}): ProcessSettings {
  return {
    mode: "image",
    sections: DEFAULT_SECTIONS,
    saveOutput: true,
    inputDir: "",
    outputDir: "",
    showResults: true,
    ...overrides,
  };
}

function withEnabled(keys: (keyof ProcessSections)[]): ProcessSections {
  const entries = (Object.keys(DEFAULT_SECTIONS) as (keyof ProcessSections)[]).map((key) => [
    key,
    { ...DEFAULT_SECTIONS[key], enabled: keys.includes(key) },
  ]);
  return Object.fromEntries(entries) as ProcessSections;
}

describe("buildProcessPayload", () => {
  it("sends only enabled sections under their wire field", () => {
    const payload = buildProcessPayload(
      settings({ sections: withEnabled(["upscale", "createVideo", "rembg"]) }),
      { images: ["upload:a"] },
    );
    expect(payload.images).toEqual(["upload:a"]);
    expect(payload.upscale).toBe(DEFAULT_SECTIONS.upscale.params);
    expect(payload.rembg).toBe(DEFAULT_SECTIONS.rembg.params);
    expect(payload.detailer).toBeUndefined();
    // a batch-only section never reaches an image run
    expect(payload.create_video).toBeUndefined();
    expect(payload.video).toBeUndefined();
    expect(payload.input_dir).toBeUndefined();
  });

  it("keeps only video-capable sections on a video run", () => {
    const s = settings({
      mode: "video",
      sections: withEnabled(["upscale", "seedvr", "dlss", "grading"]),
    });
    expect(activeSections(s)).toEqual(["seedvr", "dlss"]);
    const payload = buildProcessPayload(s, { video: "upload:v" });
    expect(payload.video).toBe("upload:v");
    expect(payload.images).toBeUndefined();
    expect(payload.upscale).toBeUndefined();
    expect(payload.seedvr).toBe(DEFAULT_SECTIONS.seedvr.params);
  });

  it("carries the folder fields and the batch video only in folder and batch modes", () => {
    const folder = buildProcessPayload(
      settings({
        mode: "folder",
        inputDir: "/in",
        outputDir: "/out",
        showResults: false,
        sections: withEnabled(["createVideo"]),
      }),
      {},
    );
    expect(folder.input_dir).toBe("/in");
    expect(folder.output_dir).toBe("/out");
    expect(folder.show_results).toBe(false);
    expect(folder.create_video).toBe(DEFAULT_SECTIONS.createVideo.params);

    const batch = buildProcessPayload(
      settings({ mode: "batch", sections: withEnabled(["createVideo"]) }),
      { images: ["upload:a", "upload:b"] },
    );
    expect(batch.create_video).toBeDefined();
    expect(batch.input_dir).toBeUndefined();
  });

  it("sends the color LUT by the ref it was staged under, never the stored setting", () => {
    const sections = withEnabled(["grading"]);
    // an older build kept the LUT as an upload ref inside the section's params
    sections.grading = {
      ...sections.grading,
      params: { ...sections.grading.params, lut_cube_file: "upload:0123456789abcdef" },
    };
    const s = settings({ sections });
    expect(buildProcessPayload(s, { images: ["upload:a"] }, "staged:lut").grading).toMatchObject({
      lut_cube_file: "staged:lut",
    });
    expect(buildProcessPayload(s, { images: ["upload:a"] }).grading).toMatchObject({
      lut_cube_file: "",
    });
    const off = settings({ sections: withEnabled(["upscale"]) });
    expect(
      buildProcessPayload(off, { images: ["upload:a"] }, "staged:lut").grading,
    ).toBeUndefined();
  });
});
