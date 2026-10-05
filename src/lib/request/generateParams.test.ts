import { describe, expect, it } from "vitest";
import { useGenerationStore, type GenerationState } from "@/stores/generationStore";
import { generationParams, type GenerateParamsContext } from "./generateParams";

const context = (patch: Partial<GenerateParamsContext> = {}): GenerateParamsContext => ({
  livePreviews: true,
  sizeMultiple: 8,
  requestSetsSize: false,
  strengthSupported: true,
  detailerMode: "inpaint",
  scripts: { selectedScript: "", scriptArgs: [], alwaysOnOverrides: {} },
  ...patch,
});

const settings = (patch: Partial<GenerationState> = {}): GenerationState => ({
  ...useGenerationStore.getInitialState(),
  ...patch,
});

describe("generationParams", () => {
  it("snaps the size to the loaded model's multiple", () => {
    const request = generationParams(
      settings({ width: 1010, height: 770 }),
      context({ sizeMultiple: 16 }),
    );
    expect(request).toMatchObject({ width_before: 1008, height_before: 768 });
  });

  it("asks for the model's own true CFG while the slider is at 0", () => {
    expect(generationParams(settings({ pagScale: 0 }), context()).cfg_true).toBe(-1);
    expect(generationParams(settings({ pagScale: 2 }), context()).cfg_true).toBe(2);
  });

  it("leaves the detailer out where the pipeline cannot run it", () => {
    const on = settings({ detailerEnabled: true });
    expect(generationParams(on, context()).detailer_enabled).toBe(true);
    expect(generationParams(on, context({ detailerMode: "none" }))).not.toHaveProperty(
      "detailer_enabled",
    );
  });

  it("sends the refine prompt whenever hires or the refiner runs", () => {
    const prompt = { refinerPrompt: "second pass" };
    expect(generationParams(settings(prompt), context())).not.toHaveProperty("refiner_prompt");
    expect(
      generationParams(settings({ ...prompt, hiresEnabled: true }), context()).refiner_prompt,
    ).toBe("second pass");
  });

  it("forces the hires pass where the request sets the output size", () => {
    const hires = settings({ hiresEnabled: true, hiresForce: false });
    expect(generationParams(hires, context({ requestSetsSize: true })).hr_force).toBe(true);
  });

  it("carries the selected script and always-on overrides", () => {
    const request = generationParams(
      settings(),
      context({
        scripts: {
          selectedScript: "X/Y/Z Grid",
          scriptArgs: [1],
          alwaysOnOverrides: { tiled: [2] },
        },
      }),
    );
    expect(request).toMatchObject({
      script_name: "X/Y/Z Grid",
      script_args: [1],
      alwayson_scripts: { tiled: { args: [2] } },
    });
  });
});
