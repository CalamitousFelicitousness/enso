import { describe, expect, it } from "vitest";
import type { JobRequest } from "@/api/types/v2";
import { currentJobRequest } from "./retiredJobFields";

const request = (type: string, fields: Record<string, unknown>) =>
  ({ type, prompt: "a cat", ...fields }) as unknown as JobRequest;

describe("currentJobRequest", () => {
  it("renames guidance fields to control_run's keywords", () => {
    const stored = request("generate", {
      cfg_end: 0.8,
      diffusers_guidance_rescale: 0.7,
      image_cfg_scale: 5,
      pag_scale: 3,
      pag_adaptive: 0.4,
    });
    expect(currentJobRequest(stored)).toEqual(
      request("generate", {
        cfg_stop: 0.8,
        cfg_rescale: 0.7,
        cfg_image: 5,
        cfg_true: 3,
        cfg_adaptive: 0.4,
      }),
    );
  });

  it("keeps the model default for a pag_scale that was off", () => {
    expect(currentJobRequest(request("generate", { pag_scale: 0 }))).toEqual(
      request("generate", { cfg_true: -1 }),
    );
  });

  it("drops fields the job schema no longer accepts", () => {
    const stored = request("generate", {
      init_control: "upload:1",
      save_mask: false,
      save_mask_composite: false,
      return_mask: false,
      return_mask_composite: false,
      send_images: true,
      override_settings: { sd_vae: "None" },
    });
    expect(currentJobRequest(stored)).toEqual(request("generate", {}));
  });

  it("prefers the current name when both are stored", () => {
    expect(currentJobRequest(request("generate", { cfg_end: 0.5, cfg_stop: 0.9 }))).toEqual(
      request("generate", { cfg_stop: 0.9 }),
    );
  });

  it("upgrades XYZ grid requests", () => {
    expect(currentJobRequest(request("xyz-grid", { cfg_end: 0.6 }))).toEqual(
      request("xyz-grid", { cfg_stop: 0.6 }),
    );
  });

  it("returns a current request as is", () => {
    const current = request("generate", { cfg_true: -1, cfg_stop: 1 });
    expect(currentJobRequest(current)).toBe(current);
  });

  it("leaves other job types alone", () => {
    const detail = request("detail", { override_settings: { sd_vae: "None" } });
    expect(currentJobRequest(detail)).toBe(detail);
  });
});
