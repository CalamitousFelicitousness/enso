// Restoring what a job ran with: its settings, its inputs, or both. Each
// restore is one Undo, offered before anything is awaited, so Ctrl+Z pressed
// while the inputs are read undoes this restore and not the one before. A
// restore started while another still reads takes its place.

import { toast } from "sonner";
import { useGenerationStore, type GenerationState } from "@/stores/generationStore";
import type { GenerationResult } from "@/stores/generationStore";
import { useImg2ImgStore } from "@/stores/img2imgStore";
import { inputsReady } from "@/stores/inputStore";
import { restoreFrames, type Inverse } from "@/inputs/edits";
import { cidsOf } from "@/lib/inputs/types";
import { loadJob, loadJobInputs, type LoadedInputs } from "@/inputs/jobs";
import { hasLegacyInputs, legacyResultInputs } from "@/inputs/legacyResult";
import { offerUndo } from "@/inputs/undo";
import type { Job } from "@/api/types/v2";
import { reasonText } from "@/lib/jobs/text";
import {
  lostPicturesText,
  restoredText,
  restoreNotesText,
  type RestoreKind,
  type RestoreNote,
} from "@/lib/jobs/text";
import {
  extractParams,
  resultSettings,
  settingsSourceOf,
  type SettingsAnswer,
  type SettingsSource,
} from "./restoreParams";

/** What a restore reads: the settings, and the inputs once asked for. */
export interface RestoreTarget {
  settings: SettingsAnswer;
  inputs: () => Promise<LoadedInputs | null>;
}

/** A strip result, at the image picked. */
export function resultTarget(result: GenerationResult, imageIndex: number): RestoreTarget {
  return {
    settings: resultSettings(result, imageIndex),
    inputs: async () => {
      const stored = await loadJobInputs(result);
      if (stored || !hasLegacyInputs(result)) return stored;
      const legacy = await legacyResultInputs(result);
      return legacy && { inputs: legacy, lost: { pictures: [], maskObjects: 0 }, maps: new Map() };
    },
  };
}

/** A job as the server lists it, with this browser's record of it. */
export async function jobTarget(job: Job): Promise<RestoreTarget> {
  const record = await loadJob(job.id);
  return {
    settings: settingsSourceOf(record, job, 0),
    inputs: () => loadJobInputs({ jobId: job.id }),
  };
}

/** Set generation settings; returns what puts back every value they changed. */
function setSettings(params: Partial<GenerationState>): () => void {
  const gen = useGenerationStore.getState();
  const keys = Object.keys(params) as (keyof GenerationState)[];
  const before = Object.fromEntries(keys.map((key) => [key, gen[key]])) as Partial<GenerationState>;
  gen.setParams(params);
  return () => useGenerationStore.getState().setParams(before);
}

/** Settings read from elsewhere (an image's metadata, a comparison), set
 * with the one Undo. */
export function applyParams(params: Partial<GenerationState>, title: string): void {
  if (Object.keys(params).length === 0) return;
  offerUndo(title, null, setSettings(params));
}

/** Apply a job's settings and return what puts back every value they changed. */
export function applySettings(source: SettingsSource): {
  revert: () => void;
  notes: RestoreNote[];
} {
  const { params, img2img, notes } = extractParams(source);
  const masks = useImg2ImgStore.getState();
  const masksBefore = {
    maskApplyOverlay: masks.maskApplyOverlay,
    inpaintingMaskWeight: masks.inpaintingMaskWeight,
  };
  const revertParams = setSettings(params);
  if (img2img.maskApplyOverlay !== undefined) masks.setMaskApplyOverlay(img2img.maskApplyOverlay);
  if (img2img.inpaintingMaskWeight !== undefined) {
    masks.setInpaintingMaskWeight(img2img.inpaintingMaskWeight);
  }
  return {
    revert: () => {
      revertParams();
      const current = useImg2ImgStore.getState();
      if (img2img.maskApplyOverlay !== undefined) {
        current.setMaskApplyOverlay(masksBefore.maskApplyOverlay);
      }
      if (img2img.inpaintingMaskWeight !== undefined) {
        current.setInpaintingMaskWeight(masksBefore.inpaintingMaskWeight);
      }
    },
    notes,
  };
}

/** Restore settings and offer the one Undo. */
export function restoreSettings(target: RestoreTarget): void {
  if (!target.settings.ok) {
    toast.info(reasonText(target.settings.reason));
    return;
  }
  const { revert, notes } = applySettings(target.settings.source);
  offerUndo(restoredText("settings"), restoreNotesText(notes), revert);
}

let latest = 0;

/** Restore inputs, or settings and inputs. The settings are applied at once;
 * the inputs replace the frames when they have been read, unless Undo or a
 * later restore came first. */
async function restoreWithInputs(target: RestoreTarget, kind: Exclude<RestoreKind, "settings">) {
  const token = ++latest;
  const gen = useGenerationStore.getState();
  // the size from before anything changed is the one Undo puts back
  const previousSize = { width: gen.width, height: gen.height };
  let applied: ReturnType<typeof applySettings> | null = null;
  if (kind === "both") {
    if (!target.settings.ok) {
      toast.info(reasonText(target.settings.reason));
      return;
    }
    applied = applySettings(target.settings.source);
  }
  const notes = applied?.notes ?? [];
  let putBack: Inverse | null = null;
  let undone = false;
  const offer = offerUndo(
    restoredText(kind),
    restoreNotesText(notes),
    () => {
      undone = true;
      // the frames first, then the settings, so the size from before wins
      putBack?.run();
      applied?.revert();
    },
    { holds: () => (putBack ? cidsOf(putBack.frames) : []) },
  );
  const live = () => !undone && token === latest;

  let loaded: LoadedInputs | null = null;
  try {
    loaded = await target.inputs();
  } catch (err) {
    console.error("[inputs] could not read a result's stored inputs", err);
  }
  if (!live()) return;
  if (!loaded) {
    if (applied) offer.update(restoredText("settings"), restoreNotesText([...notes, "inputsGone"]));
    else {
      offer.withdraw();
      toast.info(restoreNotesText(["inputsGone"]));
    }
    return;
  }
  await inputsReady();
  if (!live()) return;
  putBack = restoreFrames(loaded.inputs, previousSize);
  const lost = loaded.lost.pictures.length;
  if (lost > 0) toast.warning(lostPicturesText(lost));
}

export function restoreInputs(target: RestoreTarget): Promise<void> {
  return restoreWithInputs(target, "inputs");
}

export function restoreSettingsAndInputs(target: RestoreTarget): Promise<void> {
  return restoreWithInputs(target, "both");
}
