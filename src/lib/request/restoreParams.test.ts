import { describe, expect, it } from "vitest";
import type { GenerationInfo } from "@/api/types/generation";
import { extractParams, parseInfo, resultSettings, settingsSourceOf } from "./restoreParams";

const info = (patch: Partial<GenerationInfo>) => patch as GenerationInfo;

describe("extractParams", () => {
  it("takes the seed of the picked image of a batch", () => {
    const { params, notes } = extractParams({
      parameters: { seed: -1, subseed: -1, batch_size: 4 },
      info: info({
        seed: 100,
        subseed: 7,
        all_seeds: [100, 101, 102, 103],
        all_subseeds: [7, 8, 9, 10],
      }),
      imageIndex: 2,
    });
    expect(params.seed).toBe(102);
    expect(params.subseed).toBe(9);
    expect(params.batchSize).toBe(4);
    expect(notes).toEqual([]);
  });

  it("falls back to the job's seed, then to the seed as sent", () => {
    expect(
      extractParams({ parameters: { seed: -1 }, info: info({ seed: 55 }), imageIndex: 0 }).params
        .seed,
    ).toBe(55);
    expect(
      extractParams({ parameters: { seed: 12 }, info: info({}), imageIndex: 3 }).params.seed,
    ).toBe(12);
  });

  it("says when no seed was recorded", () => {
    const { params, notes } = extractParams({
      parameters: { seed: -1 },
      info: null,
      imageIndex: 0,
    });
    expect(params.seed).toBe(-1);
    expect(notes).toEqual(["seedNotRecorded"]);
  });

  it("leaves out a color LUT sent as an upload and says so", () => {
    const expired = extractParams({
      parameters: { seed: 1, grading_lut_file: "upload:lut", grading_lut_strength: 0.5 },
      info: null,
      imageIndex: 0,
    });
    expect("gradingLutFile" in expired.params).toBe(false);
    expect(expired.params.gradingLutStrength).toBe(0.5);
    expect(expired.notes).toEqual(["lutNotRestored"]);
    const none = extractParams({ parameters: { seed: 1 }, info: null, imageIndex: 0 });
    expect(none.params.gradingLutFile).toBe("");
  });

  it("returns the inpainting fields the request carries", () => {
    const { img2img } = extractParams({
      parameters: { mask_apply_overlay: false, inpainting_mask_weight: 0.4 },
      info: null,
      imageIndex: 0,
    });
    expect(img2img).toEqual({ maskApplyOverlay: false, inpaintingMaskWeight: 0.4 });
    expect(extractParams({ parameters: {}, info: null, imageIndex: 0 }).img2img).toEqual({});
  });
});

describe("settingsSourceOf", () => {
  const completed = { params: { prompt: "server" }, info: { seed: 9 } };

  it("reads the recorded request, with the server's info once completed", () => {
    const record = { request: { type: "generate", prompt: "sent", seed: -1 } };
    const answer = settingsSourceOf(
      record,
      { type: "generate", status: "completed", result: completed },
      1,
    );
    expect(answer).toEqual({
      ok: true,
      source: { parameters: { prompt: "sent", seed: -1 }, info: { seed: 9 }, imageIndex: 1 },
    });
    const failed = settingsSourceOf(
      record,
      { type: "generate", status: "failed", result: null },
      0,
    );
    expect(failed.ok && failed.source.info).toBeNull();
  });

  it("reads a completed job's own request without a record", () => {
    const answer = settingsSourceOf(
      null,
      { type: "generate", status: "completed", result: completed },
      0,
    );
    expect(answer.ok && answer.source.parameters).toEqual({ prompt: "server" });
    expect(settingsSourceOf(null, { type: "generate", status: "failed", result: null }, 0)).toEqual(
      {
        ok: false,
        reason: "noRecord",
      },
    );
    expect(
      settingsSourceOf(null, { type: "generate", status: "running", result: null }, 0),
    ).toEqual({
      ok: false,
      reason: "unfinished",
    });
  });

  it("gives a cloud or a video job a reason, not the defaults", () => {
    for (const type of ["cloud_image", "video", "detail", "upscale"]) {
      expect(
        settingsSourceOf(
          { request: { prompt: "x" } },
          { type, status: "completed", result: completed },
          0,
        ),
      ).toEqual({ ok: false, reason: "notGenerate" });
    }
  });
});

describe("resultSettings", () => {
  it("reads a strip result, older ones as generations", () => {
    const old = resultSettings({ parameters: { prompt: "p" }, info: '{"seed":5}' }, 0);
    expect(old).toEqual({
      ok: true,
      source: { parameters: { prompt: "p" }, info: { seed: 5 }, imageIndex: 0 },
    });
    expect(resultSettings({ parameters: {}, info: "", type: "cloud_image" }, 0)).toEqual({
      ok: false,
      reason: "notGenerate",
    });
  });

  it("reads no info from text that is not an object", () => {
    expect(parseInfo("")).toBeNull();
    expect(parseInfo("not json")).toBeNull();
    expect(parseInfo("[1]")).toBeNull();
    expect(parseInfo("{}")).toEqual({});
  });
});
