import type { GenerationState } from "@/stores/generationStore";
import { toDisplayString } from "@/lib/utils";

const KEY_MAP: Record<string, string> = {
  // Prompt
  Prompt: "prompt",
  "Negative prompt": "negativePrompt",

  // Basic
  Steps: "steps",
  "CFG scale": "cfgScale",
  Seed: "seed",
  "Size-1": "width",
  "Size-2": "height",
  Sampler: "sampler",
  "Denoising strength": "denoisingStrength",
  "Clip skip": "clipSkip",
  "Batch size": "batchSize",
  "Batch count": "batchCount",

  // Guidance
  "CFG stop": "cfgEnd",
  "CFG end": "cfgEnd",
  "CFG rescale": "guidanceRescale",
  "Image CFG scale": "imageCfgScale",
  "CFG true": "pagScale",
  "CFG adaptive": "pagAdaptive",
  "Variation seed": "subseed",
  "Variation strength": "subseedStrength",
  Tiling: "tiling",

  // Hires
  "Hires upscaler": "hiresUpscaler",
  "Hires scale": "hiresScale",
  "Hires steps": "hiresSteps",
  "Hires strength": "hiresDenoising",
  "Hires sampler": "hiresSampler",
  "Hires fixed-1": "hiresResizeX",
  "Hires fixed-2": "hiresResizeY",
  "HiRes mode": "hiresResizeMode",
  "Hires force": "hiresForce",
  "HiRes context": "hiresResizeContext",

  // Refiner
  "Refiner start": "refinerStart",
  "Refiner steps": "refinerSteps",
  "Refiner prompt": "refinerPrompt",
  "Refiner negative": "refinerNegative",

  // VAE
  "VAE type": "vaeType",

  // Scheduler
  "Sampler sigma": "sigmaMethod",
  "Sampler spacing": "timestepSpacing",
  "Sampler beta schedule": "betaSchedule",
  "Sampler type": "predictionMethod",
  "Sampler shift": "flowShift",
  "Sampler low order": "lowOrder",
  "Sampler dynamic": "thresholding",
  "Sampler rescale": "rescale",

  // Token merging
  ToMe: "tomeRatio",
  ToDo: "todoRatio",
};

const NUM_KEYS = new Set([
  "steps",
  "cfgScale",
  "seed",
  "width",
  "height",
  "denoisingStrength",
  "clipSkip",
  "batchSize",
  "batchCount",
  "cfgEnd",
  "guidanceRescale",
  "imageCfgScale",
  "pagScale",
  "pagAdaptive",
  "subseed",
  "subseedStrength",
  "hiresScale",
  "hiresSteps",
  "hiresDenoising",
  "hiresResizeX",
  "hiresResizeY",
  "hiresResizeMode",
  "refinerStart",
  "refinerSteps",
  "flowShift",
  "tomeRatio",
  "todoRatio",
]);

const BOOL_KEYS = new Set(["tiling", "hiresForce", "lowOrder", "thresholding", "rescale"]);

/** Generation settings from the parameters PNG info read out of an image. */
export function pngInfoParams(parameters: Record<string, unknown>): Partial<GenerationState> {
  const update: Record<string, unknown> = {};
  for (const [pngKey, storeKey] of Object.entries(KEY_MAP)) {
    const val = parameters[pngKey];
    if (val === undefined || val === null) continue;
    if (NUM_KEYS.has(storeKey)) {
      const n = Number(val);
      if (!Number.isNaN(n)) update[storeKey] = n;
    } else if (BOOL_KEYS.has(storeKey)) {
      update[storeKey] = val === true || val === "True" || val === "true" || val === "1";
    } else {
      update[storeKey] = toDisplayString(val);
    }
  }

  // sdnext records Attention guidance left at the model default as -1; the slider's 0 is that default
  if (typeof update["pagScale"] === "number" && update["pagScale"] < 0) update["pagScale"] = 0;

  // Auto-enable hires when any hires param is present
  if (
    update["hiresUpscaler"] ||
    update["hiresScale"] ||
    update["hiresSteps"] ||
    update["hiresDenoising"] ||
    update["hiresResizeX"] ||
    update["hiresResizeY"]
  ) {
    update["hiresEnabled"] = true;
  }

  return update;
}
