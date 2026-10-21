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
import type { LocalModel } from "@/api/types/cloud";
import type { SdModelV2 } from "@/api/types/models";
import { modelListQuery } from "@/api/hooks/useModels";
import { queryClient } from "@/api/queryClient";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { checkpointState, recordedModel } from "@/lib/recipes/models";
import { promptOpening } from "@/lib/recipes/names";
import type { ModelId } from "@/lib/recipes/recipe";
import {
  modelPickedText,
  notPickedText,
  pickedText,
  skippedSettingsText,
} from "@/lib/recipes/text";
import { newId } from "@/lib/id";
import { cloneFrames } from "@/lib/inputs/reducers";
import type { Inputs } from "@/lib/inputs/stored";
import type { ActionReason } from "@/lib/jobs/cardActions";
import { JOB_NAME, reasonText, RESULT_NAME } from "@/lib/jobs/text";
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
  type ExtractedSettings,
  type SettingsAnswer,
} from "./restoreParams";

/** A target's settings as the store takes them, or why it has none; `skipped`
 * counts the stored settings this build does not know. */
export type TargetSettings =
  { ok: true; extracted: ExtractedSettings; skipped: number } | { ok: false; reason: ActionReason };

/** A job's settings read from its request and the server's info. */
export function extractedFrom(answer: SettingsAnswer): TargetSettings {
  return answer.ok
    ? { ok: true, extracted: extractParams(answer.source), skipped: 0 }
    : { ok: false, reason: answer.reason };
}

/** What a restore reads: the settings, the inputs once asked for (their bytes
 * may come from the server), and the model they ran with. */
export interface RestoreTarget {
  /** What the source is called, under the dialog's title. */
  name: string;
  settings: TargetSettings;
  inputs: (fetch: FetchOptions) => Promise<LoadedInputs | null>;
  model: ModelId | null;
  /** How the inputs land: in place of the frames as a restore, or as a recall. */
  place: "restore" | "recall";
  /** Why the inputs cannot be restored, when the target knows it without a record. */
  inputsReason?: ActionReason | null;
}

async function recordModel(jobId: string | undefined): Promise<ModelId | null> {
  if (!jobId) return null;
  const load = await loadRecord(jobId).catch(() => null);
  return load?.record.checkpoint ? recordedModel(load.record.checkpoint) : null;
}

function promptName(prompt: unknown, fallback: string): string {
  return (typeof prompt === "string" && promptOpening(prompt)) || fallback;
}

/** A strip result, at the image picked. */
export async function resultTarget(
  result: GenerationResult,
  imageIndex: number,
): Promise<RestoreTarget> {
  return {
    name: promptName(result.parameters.prompt, RESULT_NAME),
    settings: extractedFrom(resultSettings(result, imageIndex)),
    inputs: async (fetch) => {
      const stored = await loadJobInputs(result, fetch);
      if (stored || !hasLegacyInputs(result)) return stored;
      const legacy = await legacyResultInputs(result);
      return legacy && { inputs: legacy, lost: { pictures: [], maskObjects: 0 }, maps: new Map() };
    },
    model: await recordModel(result.jobId),
    place: "restore",
  };
}

/** A job known by its id alone, as a Gallery file or a picture's stamp names it. */
export async function recordTarget(jobId: string): Promise<RestoreTarget> {
  const load = await loadRecord(jobId);
  const type = load?.record.request["type"];
  return {
    name: promptName(load?.record.request["prompt"], JOB_NAME),
    settings: load
      ? extractedFrom(
          settingsSourceOf(
            load.record,
            { type: typeof type === "string" ? type : "", status: "completed", result: null },
            0,
          ),
        )
      : { ok: false, reason: "noRecord" },
    inputs: (fetch) => loadJobInputs({ jobId }, fetch),
    model: load?.record.checkpoint ? recordedModel(load.record.checkpoint) : null,
    place: "restore",
  };
}

/** A job as the server lists it, with its record. */
export async function jobTarget(job: Job): Promise<RestoreTarget> {
  const load = await loadRecord(job.id);
  return {
    name: promptName(load?.record.request["prompt"] ?? job.result?.params["prompt"], JOB_NAME),
    settings: extractedFrom(settingsSourceOf(load?.record ?? null, job, 0)),
    inputs: (fetch) => loadJobInputs({ jobId: job.id }, fetch),
    model: load?.record.checkpoint ? recordedModel(load.record.checkpoint) : null,
    place: "restore",
  };
}

/** What restoring a target's model does: pick a local checkpoint in the Model
 * Selector, or say the model is not on this server. */
export type ModelPick = { kind: "pick"; model: LocalModel } | { kind: "missing"; name: string };

/** The pick a restore makes without asking: the installed file, unless it is
 * already picked; a model not found is said; one installed by name only is
 * left to the Restore dialog's Model switch. */
export async function modelPick(model: ModelId | null): Promise<ModelPick | null> {
  if (!model) return null;
  const installed = await queryClient.fetchQuery(modelListQuery).catch(() => null);
  if (!installed) return null;
  const { state, match } = checkpointState(model, installed);
  if (state === "missing") return { kind: "missing", name: model.name };
  if (state !== "installed" || !match) return null;
  return pickOf(match);
}

/** A pick of a listed checkpoint; none when it is the one already picked. */
export function pickOf(model: SdModelV2): ModelPick | null {
  const active = useModelSelectionStore.getState().activeModel;
  if (active?.source === "local" && active.title === model.title) return null;
  return { kind: "pick", model: { ...model, source: "local" } };
}

/** Make the pick; returns what puts the previous one back. */
function applyPick(pick: ModelPick | null): () => void {
  if (pick?.kind !== "pick") return () => {};
  const store = useModelSelectionStore.getState();
  const before = store.activeModel;
  store.setActiveModel(pick.model);
  return () => useModelSelectionStore.getState().setActiveModel(before);
}

function pickNote(pick: ModelPick | null): string | null {
  if (!pick) return null;
  return pick.kind === "pick" ? modelPickedText(pick.model.model_name) : notPickedText(pick.name);
}

function skippedNote(target: RestoreTarget): string | null {
  return target.settings.ok && target.settings.skipped > 0
    ? skippedSettingsText(target.settings.skipped)
    : null;
}

/** Recalled frames under ids of their own, the links outside them dropped. */
function recalled(inputs: Inputs): Inputs {
  const clone = cloneFrames(inputs.frames, inputs.sizeSource, newId, "drop");
  return { frames: clone.frames, size: inputs.size, sizeSource: clone.sizeSource };
}

function joinNotes(...notes: (string | null)[]): string | null {
  const said = notes.filter((n) => n !== null);
  return said.length > 0 ? said.join(". ") : null;
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

/** Apply read settings and return what puts back every value they changed. */
export function applySettings(extracted: ExtractedSettings): {
  revert: () => void;
  notes: RestoreNote[];
} {
  const { params, img2img, notes } = extracted;
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

/** Restore settings, with the model pick when one is given, and offer the one Undo. */
export function restoreSettings(target: RestoreTarget, pick: ModelPick | null = null): void {
  if (!target.settings.ok) {
    toast.info(reasonText(target.settings.reason));
    return;
  }
  const { revert, notes } = applySettings(target.settings.extracted);
  const unpick = applyPick(pick);
  offerUndo(
    pick?.kind === "pick" ? pickedText(pick.model.model_name) : restoredText("settings"),
    joinNotes(
      restoreNotesText(notes),
      skippedNote(target),
      pick?.kind === "missing" ? pickNote(pick) : null,
    ),
    () => {
      unpick();
      revert();
    },
  );
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
  pick: ModelPick | null = null,
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
    applied = applySettings(target.settings.extracted);
  }
  // the model goes with the settings
  const unpick = applied ? applyPick(pick) : () => {};
  const modelNote = applied ? pickNote(pick) : null;
  const notes = applied?.notes ?? [];
  let putBack: Inverse | null = null;
  let undone = false;
  const abort = new AbortController();
  const cancel = () => {
    undone = true;
    abort.abort();
    unpick();
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
      unpick();
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
      offer.update(
        restoredText("settings", elsewhere),
        joinNotes(restoreNotesText([...notes, "inputsGone"]), skippedNote(target), modelNote),
      );
    } else {
      offer.withdraw();
      toast.info(restoreNotesText(["inputsGone"]));
    }
    return;
  }
  await inputsReady();
  if (!live()) return;
  putBack = restoreFrames(
    target.place === "recall" ? recalled(loaded.inputs) : loaded.inputs,
    previousSize,
  );
  offer.update(
    restoredText(kind, elsewhere),
    joinNotes(restoreNotesText(notes), applied ? skippedNote(target) : null, modelNote),
  );
  const lost = loaded.lost.pictures.length;
  if (lost > 0) toast.warning(lostPicturesText(lost));
}

export function restoreInputs(target: RestoreTarget): Promise<void> {
  return restoreWithInputs(target, "inputs");
}

export function restoreSettingsAndInputs(
  target: RestoreTarget,
  pick: ModelPick | null = null,
): Promise<void> {
  return restoreWithInputs(target, "both", false, pick);
}

/** A restore started outside the Images view: that view opens, and the
 * notice says where the inputs went. */
export function restoreInImages(
  target: RestoreTarget,
  kind: Exclude<RestoreKind, "settings">,
  pick: ModelPick | null = null,
): Promise<void> {
  useUiStore.getState().setNavView("images");
  return restoreWithInputs(target, kind, true, pick);
}

/** A restore from a menu or a card: the target read first, then the model
 * picked as `modelPick` decides. */
export async function restoreFrom(
  target: Promise<RestoreTarget>,
  kind: RestoreKind,
  elsewhere = false,
): Promise<void> {
  const read = await target;
  const pick = kind === "inputs" ? null : await modelPick(read.model);
  if (kind === "settings") return restoreSettings(read, pick);
  if (elsewhere) return restoreInImages(read, kind, pick);
  return kind === "inputs" ? restoreInputs(read) : restoreSettingsAndInputs(read, pick);
}
