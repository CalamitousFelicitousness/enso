import type { ProcessJobParams, ProcessMode } from "@/api/types/v2";
import type { ProcessSectionKey, ProcessSections } from "@/stores/processStore";

/** Sections whose script takes a video input. */
export const VIDEO_SECTIONS: readonly ProcessSectionKey[] = ["seedvr", "dlss"];
/** Sections that run once over every output of a batch or folder run. */
export const BATCH_SECTIONS: readonly ProcessSectionKey[] = ["createVideo"];

const WIRE_FIELD: Record<ProcessSectionKey, keyof ProcessJobParams> = {
  upscale: "upscale",
  detailer: "detailer",
  grading: "grading",
  rembg: "rembg",
  nudenet: "nudenet",
  seedvr: "seedvr",
  pixelart: "pixelart",
  dlss: "dlss",
  createVideo: "create_video",
};

/** Whether a section does anything for the mode; the panel greys out the rest. */
export function sectionApplies(key: ProcessSectionKey, mode: ProcessMode): boolean {
  if (mode === "video") return VIDEO_SECTIONS.includes(key);
  if (BATCH_SECTIONS.includes(key)) return mode === "batch" || mode === "folder";
  return true;
}

export interface ProcessSettings {
  mode: ProcessMode;
  sections: ProcessSections;
  saveOutput: boolean;
  inputDir: string;
  outputDir: string;
  showResults: boolean;
}

export interface ProcessInputs {
  /** Upload refs, image and batch modes. */
  images?: string[] | undefined;
  /** Upload ref, video mode. */
  video?: string | undefined;
}

/** Enabled sections that apply to the mode, in store order. */
export function activeSections(settings: ProcessSettings): ProcessSectionKey[] {
  return (Object.keys(settings.sections) as ProcessSectionKey[]).filter(
    (key) => settings.sections[key].enabled && sectionApplies(key, settings.mode),
  );
}

export function buildProcessPayload(
  settings: ProcessSettings,
  inputs: ProcessInputs,
): ProcessJobParams {
  const payload: ProcessJobParams = {
    type: "process",
    mode: settings.mode,
    save_output: settings.saveOutput,
  };
  if (settings.mode === "image" || settings.mode === "batch") payload.images = inputs.images;
  if (settings.mode === "video") payload.video = inputs.video;
  if (settings.mode === "folder") {
    payload.input_dir = settings.inputDir;
    payload.output_dir = settings.outputDir;
    payload.show_results = settings.showResults;
  }
  for (const key of activeSections(settings)) {
    // Each section's params object has the wire shape of its field.
    Object.assign(payload, { [WIRE_FIELD[key]]: settings.sections[key].params });
  }
  return payload;
}
