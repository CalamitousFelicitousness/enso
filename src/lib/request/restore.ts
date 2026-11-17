// Restoring what a job ran with: its settings, its inputs, or both. A restore
// that reads first is a wait, opened before anything is awaited, so Ctrl+Z
// pressed while it reads cancels it and not the change before; it lands as
// one step. A restore started while another still reads takes its place.

import { toast } from "sonner";
import { useGenerationStore, type GenerationState } from "@/stores/generationStore";
import type { GenerationResult } from "@/stores/generationStore";
import { useImg2ImgStore } from "@/stores/img2imgStore";
import { useUiStore } from "@/stores/uiStore";
import { inputsReady } from "@/stores/inputStore";
import { restoreFrames } from "@/inputs/edits";
import type { FetchOptions } from "@/inputs/fetch";
import { loadJobInputs, loadRecord, type LoadedInputs } from "@/inputs/jobs";
import { UserAbortError } from "@/lib/abort";
import { fetchingText } from "@/lib/media/text";
import { hasLegacyInputs, legacyResultInputs } from "@/inputs/legacyResult";
import { announce, title, wait, type WaitHandle } from "@/undo/marks";
import type { StepName } from "@/lib/undo/types";
import { nameText } from "@/lib/undo/text";
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

/** Make the pick: it rides on the restore's step. */
function applyPick(pick: ModelPick | null): void {
  if (pick?.kind === "pick") useModelSelectionStore.getState().setActiveModel(pick.model);
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

/** Settings read from elsewhere (an image's metadata, a comparison), set as
 * one step under `name`. */
export function applyParams(params: Partial<GenerationState>, name: StepName): void {
  if (Object.keys(params).length === 0) return;
  title(name);
  useGenerationStore.getState().setParams(params);
  announce("images").show(nameText(name));
}

/** Apply read settings; returns what they could not restore. */
export function applySettings(extracted: ExtractedSettings): RestoreNote[] {
  const { params, img2img, notes } = extracted;
  useGenerationStore.getState().setParams(params);
  if (img2img.maskApplyOverlay !== undefined) {
    useImg2ImgStore.getState().setMaskApplyOverlay(img2img.maskApplyOverlay);
  }
  return notes;
}

const restoreName = (kind: RestoreKind): StepName => ({ kind: "restore", args: { what: kind } });

/** Restore settings, with the model pick when one is given, as one step:
 * called in the click, or in the landing of a restore that read first. */
export function restoreSettings(target: RestoreTarget, pick: ModelPick | null = null): void {
  if (!target.settings.ok) {
    toast.info(reasonText(target.settings.reason));
    return;
  }
  title(restoreName("settings"));
  const notes = applySettings(target.settings.extracted);
  applyPick(pick);
  announce("images").show(
    pick?.kind === "pick" ? pickedText(pick.model.model_name) : restoredText("settings"),
    {
      description: joinNotes(
        restoreNotesText(notes),
        skippedNote(target),
        pick?.kind === "missing" ? pickNote(pick) : null,
      ),
    },
  );
}

let latest = 0;

/** Restore inputs, or settings and inputs, as a wait: nothing changes until
 * the inputs have been read, then the settings, the model pick and the frames
 * land as one step. While their bytes come from the server the wait's notice
 * says how far, and its Cancel, Undo or Ctrl+Z stop it. When the inputs are
 * gone the settings land alone with a note. A later restore takes the place
 * of one still reading. */
async function restoreWithInputs(
  target: RestoreTarget,
  kind: Exclude<RestoreKind, "settings">,
  elsewhere: boolean,
  pick: ModelPick | null,
  opened: WaitHandle | null = null,
) {
  const waited = opened ?? wait("images", restoreName(kind), { replaces: true });
  const token = ++latest;
  try {
    if (kind === "both" && !target.settings.ok) {
      toast.info(reasonText(target.settings.reason));
      return;
    }
    waited.progress(restoringText(kind, elsewhere));
    const modelNote = kind === "both" ? pickNote(pick) : null;
    let loaded: LoadedInputs | null = null;
    try {
      loaded = await target.inputs({
        signal: waited.signal,
        onProgress: (p) => waited.progress(fetchingText(p.done, p.total, p.bytes)),
      });
    } catch (err) {
      if (!(err instanceof UserAbortError)) {
        console.error("[inputs] could not read a result's stored inputs", err);
      }
    }
    if (waited.cancelled || token !== latest) return;
    const settings = () => {
      if (kind !== "both" || !target.settings.ok) return [];
      const notes = applySettings(target.settings.extracted);
      applyPick(pick);
      return notes;
    };
    if (!loaded) {
      if (kind !== "both") {
        toast.info(restoreNotesText(["inputsGone"]));
        return;
      }
      waited.land(() => {
        const notes = settings();
        announce("images").show(restoredText("settings", elsewhere), {
          description: joinNotes(
            restoreNotesText([...notes, "inputsGone"]),
            skippedNote(target),
            modelNote,
          ),
        });
      }, restoreName("settings"));
      return;
    }
    await inputsReady();
    if (waited.cancelled || token !== latest) return;
    const inputs = target.place === "recall" ? recalled(loaded.inputs) : loaded.inputs;
    const gen = useGenerationStore.getState();
    // the size the displaced inputs were made at, before the settings change it
    const previousSize = { width: gen.width, height: gen.height };
    waited.land(() => {
      const notes = settings();
      restoreFrames(inputs, previousSize);
      announce("images").show(restoredText(kind, elsewhere), {
        description: joinNotes(
          restoreNotesText(notes),
          kind === "both" ? skippedNote(target) : null,
          modelNote,
        ),
      });
    });
    const lost = loaded.lost.pictures.length;
    if (lost > 0) toast.warning(lostPicturesText(lost));
  } finally {
    waited.end();
  }
}

export function restoreInputs(target: RestoreTarget): Promise<void> {
  return restoreWithInputs(target, "inputs", false, null);
}

export function restoreSettingsAndInputs(
  target: RestoreTarget,
  pick: ModelPick | null = null,
): Promise<void> {
  return restoreWithInputs(target, "both", false, pick);
}

/** A restore from a menu or a card: the target read first, then the model
 * picked as `modelPick` decides. A wait from the start; one started outside
 * the Images view opens that view, and its notice says where the inputs went. */
export async function restoreFrom(
  target: Promise<RestoreTarget>,
  kind: RestoreKind,
  elsewhere = false,
): Promise<void> {
  const waited = wait("images", restoreName(kind), { replaces: kind !== "settings" });
  let handed = false;
  try {
    const read = await target;
    const pick = kind === "inputs" ? null : await modelPick(read.model);
    if (waited.cancelled) return;
    if (kind === "settings") {
      waited.land(() => restoreSettings(read, pick));
      return;
    }
    if (elsewhere) useUiStore.getState().setNavView("images");
    handed = true;
    await restoreWithInputs(read, kind, elsewhere, pick, waited);
  } finally {
    if (!handed) waited.end();
  }
}
