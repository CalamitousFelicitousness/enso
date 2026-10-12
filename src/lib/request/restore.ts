// Restoring what a job ran with: its settings, its inputs, or both. Each
// restore is one Undo, offered before anything is awaited, so Ctrl+Z pressed
// while the inputs are read undoes this restore and not the one before. A
// restore started while another still reads takes its place.

import { toast } from "sonner";
import { useGenerationStore, type GenerationState } from "@/stores/generationStore";
import type { GenerationResult } from "@/stores/generationStore";
import { useImg2ImgStore } from "@/stores/img2imgStore";
import { useUiStore } from "@/stores/uiStore";
import { inputsReady } from "@/stores/inputStore";
import { restoreFrames, type Inverse } from "@/inputs/edits";
import { cidsOf } from "@/lib/inputs/types";
import type { FetchOptions } from "@/inputs/fetch";
import { loadJobInputs, loadRecord, type LoadedInputs } from "@/inputs/jobs";
import { UserAbortError } from "@/lib/abort";
import { fetchingText, RESTORE_CANCELLED } from "@/lib/media/text";
import { hasLegacyInputs, legacyResultInputs } from "@/inputs/legacyResult";
import { offerUndo } from "@/inputs/undo";
import type { Job } from "@/api/types/v2";
import { reasonText } from "@/lib/jobs/text";
import {
  lostPicturesText,
  restoredText,
  restoreNotesText,
  restoringText,
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

/** What a restore reads: the settings, and the inputs once asked for, whose
 * bytes may come from the server. */
export interface RestoreTarget {
  settings: SettingsAnswer;
  inputs: (fetch: FetchOptions) => Promise<LoadedInputs | null>;
}

/** A strip result, at the image picked. */
export function resultTarget(result: GenerationResult, imageIndex: number): RestoreTarget {
  return {
    settings: resultSettings(result, imageIndex),
    inputs: async (fetch) => {
      const stored = await loadJobInputs(result, fetch);
      if (stored || !hasLegacyInputs(result)) return stored;
      const legacy = await legacyResultInputs(result);
      return legacy && { inputs: legacy, lost: { pictures: [], maskObjects: 0 }, maps: new Map() };
    },
  };
}

/** A job known by its id alone, as a Gallery file or a picture's stamp names it. */
export async function recordTarget(jobId: string): Promise<RestoreTarget> {
  const load = await loadRecord(jobId);
  const type = load?.record.request["type"];
  return {
    settings: load
      ? settingsSourceOf(
          load.record,
          { type: typeof type === "string" ? type : "", status: "completed", result: null },
          0,
        )
      : { ok: false, reason: "noRecord" },
    inputs: (fetch) => loadJobInputs({ jobId }, fetch),
  };
}

/** A job as the server lists it, with its record. */
export async function jobTarget(job: Job): Promise<RestoreTarget> {
  const load = await loadRecord(job.id);
  return {
    settings: settingsSourceOf(load?.record ?? null, job, 0),
    inputs: (fetch) => loadJobInputs({ jobId: job.id }, fetch),
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

/** The restore still waiting on its inputs: a newer restore cancels it first,
 * so the settings it applied do not outlive it. */
let waiting: { cancel: () => void } | null = null;

/** Restore inputs, or settings and inputs. The settings are applied at once;
 * the inputs replace the frames when they have been read, unless Undo or a
 * later restore came first. While their bytes come from the server the
 * notice says how far, and Cancel, Undo or Ctrl+Z stop it and put the
 * settings back. */
async function restoreWithInputs(
  target: RestoreTarget,
  kind: Exclude<RestoreKind, "settings">,
  elsewhere = false,
) {
  waiting?.cancel();
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
  const abort = new AbortController();
  const cancel = () => {
    undone = true;
    abort.abort();
    applied?.revert();
  };
  const self = { cancel };
  waiting = self;
  const offer = offerUndo(
    restoringText(kind, elsewhere),
    null,
    () => {
      if (!putBack) {
        cancel();
        toast.info(RESTORE_CANCELLED);
        return;
      }
      undone = true;
      // the frames first, then the settings, so the size from before wins
      putBack.run();
      applied?.revert();
    },
    {
      holds: () => (putBack ? cidsOf(putBack.frames) : []),
      // another change took the notice: the inputs no longer land over it
      settle: () => {
        if (!putBack) abort.abort();
      },
      waiting: true,
    },
  );
  const live = () => !undone && token === latest && !abort.signal.aborted;

  let loaded: LoadedInputs | null = null;
  try {
    loaded = await target.inputs({
      signal: abort.signal,
      onProgress: (p) => offer.progress(fetchingText(p.done, p.total, p.bytes)),
    });
  } catch (err) {
    if (!(err instanceof UserAbortError)) {
      console.error("[inputs] could not read a result's stored inputs", err);
    }
  } finally {
    if (waiting === self) waiting = null;
  }
  if (!live()) return;
  if (!loaded) {
    if (applied) {
      offer.update(restoredText("settings", elsewhere), restoreNotesText([...notes, "inputsGone"]));
    } else {
      offer.withdraw();
      toast.info(restoreNotesText(["inputsGone"]));
    }
    return;
  }
  await inputsReady();
  if (!live()) return;
  putBack = restoreFrames(loaded.inputs, previousSize);
  offer.update(restoredText(kind, elsewhere), restoreNotesText(notes));
  const lost = loaded.lost.pictures.length;
  if (lost > 0) toast.warning(lostPicturesText(lost));
}

export function restoreInputs(target: RestoreTarget): Promise<void> {
  return restoreWithInputs(target, "inputs");
}

export function restoreSettingsAndInputs(target: RestoreTarget): Promise<void> {
  return restoreWithInputs(target, "both");
}

/** A restore started outside the Images view: that view opens, and the
 * notice says where the inputs went. */
export function restoreInImages(
  target: RestoreTarget,
  kind: Exclude<RestoreKind, "settings">,
): Promise<void> {
  useUiStore.getState().setNavView("images");
  return restoreWithInputs(target, kind, true);
}
