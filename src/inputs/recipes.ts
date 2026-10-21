// Recipes: a generation kept instead of run. A save builds what Generate or
// Run again would send, uploads what the server lacks under the recipe
// action, and posts it to the library with the settings as set, the
// checkpoint, the prompt's networks and a preview. A recipe is restored
// through the Restore dialog and run as a job's record is run again.

import { toast } from "sonner";
import { create } from "zustand";
import { api, ApiError } from "@/api/client";
import { claim } from "@/api/blobs";
import { modelListQuery } from "@/api/hooks/useModels";
import { loraListQuery } from "@/api/hooks/useNetworks";
import { queryClient } from "@/api/queryClient";
import { LIBRARY_KEY } from "@/api/queryKeys";
import type {
  ItemEntryV2,
  ReqEntryV2,
  ResEntryChangeV2,
  ResEntryV2,
  ResLibraryV2,
} from "@/api/types/media";
import type { Job } from "@/api/types/v2";
import { UserAbortError } from "@/lib/abort";
import { newId } from "@/lib/id";
import { entryThumbs } from "@/lib/inputs/library";
import {
  joinInputs,
  readStoredInputs,
  storedInputsOf,
  type Inputs,
  type StoredInputs,
} from "@/lib/inputs/stored";
import { NO_LONGER_IN_LIBRARY, SAVE_FAILED, savedText, SHOW_IN_LIBRARY } from "@/lib/inputs/text";
import type { JsonValue } from "@/lib/inputs/types";
import { isUploadRef, replayProblem } from "@/lib/jobs/replay";
import { reasonText, replayMissingText } from "@/lib/jobs/text";
import { entrySummary } from "@/lib/media/entry";
import { ACTIONS } from "@/lib/media/progress";
import { isGone, type Outcome } from "@/lib/media/stage";
import {
  batchText,
  CANCEL,
  inTrashText,
  UPLOAD_CANCELLED,
  UPLOAD_STOPPED,
  WAIT_FOR_UPLOAD,
} from "@/lib/media/text";
import { recipeLoad, requestHashes } from "@/lib/recipes/load";
import { recipeStates, recordedModel } from "@/lib/recipes/models";
import { defaultRecipeName } from "@/lib/recipes/names";
import { networksIn } from "@/lib/recipes/networks";
import { portableRequest } from "@/lib/recipes/portable";
import { readRecipe, readSettings, RECIPE_SCHEMA, type Recipe } from "@/lib/recipes/recipe";
import { settingsOf, snapshotSettings } from "@/lib/recipes/settings";
import {
  loadingForText,
  modelLineText,
  READ_RECIPE_FAILED,
  RECIPE_ONLY_GENERATE,
  RECIPE_QUEUED,
  RUN_RECIPE_FAILED,
  runsOnLoadedText,
  settingsLeftOutText,
} from "@/lib/recipes/text";
import { jobTarget, recordTarget, resultTarget, type RestoreTarget } from "@/lib/request/restore";
import type { RecipeV2 } from "@/lib/openapi-generated/types.gen";
import { mediaFile } from "@/lib/mediaFiles";
import { defaultParams, useGenerationStore, type GenerationResult } from "@/stores/generationStore";
import { useModelHashStore } from "@/stores/modelHashStore";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { runAction } from "./action";
import { buildImagesSubmission } from "./buildImages";
import { bytesFor, type FetchOptions } from "./fetch";
import {
  goneForGood,
  replaySubmission,
  type LoadedInputs,
  type RecordLoad,
  loadRecord,
} from "./jobs";
import {
  applyEntry,
  movedText,
  refused,
  showLibrary,
  touchEntry,
  useLibrarySaving,
} from "./library";
import { modelFirst } from "./modelFirst";
import { cancelAction, useSubmitProgress } from "./progress";
import { installEntryMaps } from "./recall";
import { missingHashes, prepare, submitJob, type Submission } from "./submit";
import { thumbBlob, thumbOf } from "./thumbs";
import { UploadBatch } from "./uploads";

/** Where a recipe is saved from: the canvas and settings as they stand, a
 * strip result at an image, a History job, or a Gallery file's job with the
 * seed its picture's metadata names. */
export type RecipeFrom =
  | { kind: "current" }
  | { kind: "result"; result: GenerationResult; imageIndex: number }
  | { kind: "job"; job: Job }
  | { kind: "file"; jobId: string; path: string; seed: number | null };

/** Recipes being run, by entry id, so their slots read busy. */
export const useRecipeRuns = create<{ running: ReadonlySet<string> }>()(() => ({
  running: new Set(),
}));

function setRunning(id: string, on: boolean): void {
  useRecipeRuns.setState((s) => {
    const running = new Set(s.running);
    if (on) running.add(id);
    else running.delete(id);
    return { running };
  });
}

/** A refusal already told; the save ends quietly. */
function told(text: string): never {
  toast.info(text);
  throw new UserAbortError(text);
}

/** What a save sends before its uploads have run. */
interface Made {
  submission: Submission;
  settings: Record<string, JsonValue>;
  /** The LUT's name, when the request sends one. */
  lutName: string | null;
  /** The seed the result was made with, pinned into the request. */
  seed: number | null;
  /** The output the recipe came from, for its card. */
  preview: Blob | null;
}

/** The current state as Generate would send it, every input kept with the recipe. */
async function fromCurrent(batch: UploadBatch): Promise<Made> {
  if (useModelSelectionStore.getState().activeModel?.source === "cloud") told(RECIPE_ONLY_GENERATE);
  const submission = await buildImagesSubmission(batch);
  if (submission.request.type !== "generate") told(RECIPE_ONLY_GENERATE);
  // a picture the recipe cannot keep refuses the save rather than leaving it out
  const inputs = submission.inputs as Inputs | null;
  for (const frame of inputs?.frames ?? []) {
    for (const p of frame.pictures) batch.stage(p.file, { name: p.name, cid: p.cid });
    for (const o of frame.mask.objects) batch.stage(o.blob, { name: o.name, cid: o.cid });
    for (const m of frame.ipAdapter.masks) batch.stage(m.file, { name: m.name, cid: m.cid });
  }
  const gen = useGenerationStore.getState();
  return {
    submission,
    settings: snapshotSettings(gen, defaultParams),
    lutName: gen.gradingLutFile || null,
    seed: null,
    preview: null,
  };
}

/** The job a Gallery file names, with the server's info while its row lives. */
async function fileTarget(jobId: string): Promise<RestoreTarget> {
  const job = await api.get<Job>(`/sdapi/v2/jobs/${encodeURIComponent(jobId)}`).catch(() => null);
  return job ? jobTarget(job) : recordTarget(jobId);
}

function previewUrl(from: Exclude<RecipeFrom, { kind: "current" }>): string | null {
  if (from.kind === "result") return from.result.images[from.imageIndex] ?? null;
  if (from.kind === "job") return from.job.result?.images[0]?.url ?? null;
  return `/sdapi/v2/browser/file?path=${encodeURIComponent(from.path)}`;
}

/** A job's record sent again as a recipe, its seed the one the picture was made with. */
async function fromRecord(
  from: Exclude<RecipeFrom, { kind: "current" }>,
  batch: UploadBatch,
): Promise<Made> {
  const jobId =
    from.kind === "result" ? from.result.jobId : from.kind === "job" ? from.job.id : from.jobId;
  if (!jobId) told(reasonText("olderResult"));
  const load = await loadRecord(jobId);
  if (!load) told(reasonText("noRecord"));
  if (load.record.request["type"] !== "generate") told(RECIPE_ONLY_GENERATE);
  const target =
    from.kind === "result"
      ? await resultTarget(from.result, from.imageIndex)
      : from.kind === "job"
        ? await jobTarget(from.job)
        : await fileTarget(jobId);
  if (!target.settings.ok) told(reasonText(target.settings.reason));
  const settings = settingsOf(target.settings.extracted);
  const recorded = settings["seed"];
  let seed = typeof recorded === "number" && recorded >= 0 ? recorded : null;
  if (seed === null && from.kind === "file" && from.seed !== null) {
    seed = from.seed;
    settings["seed"] = from.seed;
  }
  const lut = settings["gradingLutFile"];
  const url = previewUrl(from);
  const preview = url ? await mediaFile(url, "preview.png").catch(() => null) : null;
  return {
    submission: replaySubmission(load, batch),
    settings,
    lutName: typeof lut === "string" && lut !== "" ? lut : null,
    seed,
    preview,
  };
}

function isStored(inputs: Inputs | StoredInputs): inputs is StoredInputs {
  return "schema" in inputs;
}

/** The thumbnails of the inputs' shown pictures, staged on the batch. */
async function stageThumbs(
  inputs: Inputs | StoredInputs | null,
  batch: UploadBatch,
): Promise<Map<string, { ref: string; width: number; height: number }>> {
  const staged = new Map<string, { ref: string; width: number; height: number }>();
  if (!inputs) return staged;
  const stored = isStored(inputs) ? inputs : storedInputsOf(inputs);
  const files = new Map<string, Blob>();
  if (!isStored(inputs)) {
    for (const frame of inputs.frames)
      for (const p of frame.pictures) if (p.file) files.set(p.cid, p.file);
  }
  for (const picture of entryThumbs({ kind: "set", inputs: stored }).pictures) {
    const thumb = await thumbBlob({
      cid: picture.cid,
      file: files.get(picture.cid) ?? null,
      width: picture.width,
      height: picture.height,
    }).catch(() => null);
    if (!thumb) continue;
    const { ref } = batch.stage(thumb, { name: `${picture.name}.webp` });
    staged.set(picture.cid, { ref, width: picture.width, height: picture.height });
  }
  return staged;
}

function hashOf(outcomes: ReadonlyMap<string, Outcome>, ref: string): string | null {
  const outcome = outcomes.get(ref);
  return outcome && !isGone(outcome) ? outcome.hash : null;
}

/** Names the library holds, so a new recipe's default name is its own. */
function takenNames(): Set<string> {
  const listed = queryClient.getQueryData<ResLibraryV2>(LIBRARY_KEY)?.entries ?? [];
  return new Set(listed.map((e) => e.name));
}

function promptOf(request: Record<string, JsonValue>, key: string): string {
  const value = request[key];
  return typeof value === "string" ? value : "";
}

/** The second line of a save's notice: a model or LoRA this server lacks. */
async function modelsNote(head: ItemEntryV2["recipe"]): Promise<string | null> {
  if (!head) return null;
  try {
    const recipe = head as unknown as Pick<Recipe, "checkpoint" | "networks">;
    const [checkpoints, networks] = await Promise.all([
      queryClient.fetchQuery(modelListQuery),
      queryClient.fetchQuery(loraListQuery),
    ]);
    const states = recipeStates(
      { checkpoint: recipe.checkpoint, networks: recipe.networks ?? [] },
      checkpoints,
      networks,
      useModelHashStore.getState().downloads,
    );
    const model =
      recipe.checkpoint && states.checkpoint
        ? { name: recipe.checkpoint.name, state: states.checkpoint.state }
        : null;
    if ((!model || model.state === "installed") && states.missingNetworks === 0) return null;
    return modelLineText(model, states.missingNetworks);
  } catch {
    return null;
  }
}

/** While the save uploads, its notice says how far, with Stop. */
function followProgress(toastId: string): () => void {
  return useSubmitProgress.subscribe((s) => {
    const p = s.byAction[ACTIONS.recipe];
    if (!p || p.phase !== "uploading" || p.files === 0) return;
    toast.loading(batchText(p.done, p.files, p.sent, p.total), {
      id: toastId,
      cancel: { label: CANCEL, onClick: () => cancelAction(ACTIONS.recipe) },
    });
  });
}

/** Save a recipe to the library. Null when nothing was saved; the user has
 * been told why. Refused while Generate uploads, and Generate waits for it. */
export async function saveRecipe(from: RecipeFrom): Promise<ItemEntryV2 | null> {
  if (useSubmitProgress.getState().byAction[ACTIONS.images]) {
    toast.info(WAIT_FOR_UPLOAD);
    return null;
  }
  const toastId = `recipe-save-${newId()}`;
  const unfollow = followProgress(toastId);
  useLibrarySaving.setState((s) => ({ saving: s.saving + 1 }));
  try {
    return await runAction(
      ACTIONS.recipe,
      async (ctx) => {
        const made =
          from.kind === "current"
            ? await fromCurrent(ctx.batch)
            : await fromRecord(from, ctx.batch);
        const { submission } = made;
        const thumbs = await stageThumbs(submission.inputs, ctx.batch);
        const preview = made.preview ? await thumbOf(made.preview).catch(() => null) : null;
        const previewRef = preview
          ? ctx.batch.stage(preview.blob, { name: "preview.webp" }).ref
          : null;
        const prepared = await prepare(submission);
        const { record, outcomes } = prepared;
        const sent = { ...(prepared.request as unknown as Record<string, JsonValue>) };
        if (made.seed !== null) sent["seed"] = made.seed;
        const portable = portableRequest(sent);
        if (portable.unknown.length > 0) {
          console.warn("[recipes] left out fields neither list knows", portable.unknown);
        }
        const request: Record<string, JsonValue> = { ...portable.request, type: "generate" };
        const previewHash = previewRef ? hashOf(outcomes, previewRef) : null;
        const recipe: RecipeV2 = {
          recipe_schema: RECIPE_SCHEMA,
          request,
          refs: record?.refs ?? {},
          map_keys: record?.map_keys ?? [],
          settings: made.settings,
          checkpoint: submission.checkpoint ? recordedModel(submission.checkpoint) : null,
          networks: networksIn(
            promptOf(request, "prompt"),
            promptOf(request, "negative_prompt"),
          ).map((n) => ({ ...n, sha256: null, short: null })),
          lut: isUploadRef(request["grading_lut_file"])
            ? { name: made.lutName ?? "Color LUT" }
            : null,
          preview:
            preview && previewHash
              ? { thumb: previewHash, width: preview.width, height: preview.height }
              : null,
        };
        const inputs = (record?.inputs ?? null) as StoredInputs | null;
        const body: ReqEntryV2 = {
          id: newId(),
          kind: "recipe",
          name: defaultRecipeName(
            promptOf(request, "prompt"),
            Date.now(),
            Intl.DateTimeFormat().resolvedOptions().timeZone,
            takenNames(),
          ),
          summary: entrySummary("recipe", inputs),
          inputs: record?.inputs ?? null,
          maps: record?.maps ?? {},
          hashes: record?.hashes ?? {},
          unavailable: record?.unavailable ?? [],
          thumbs: [...thumbs].flatMap(([cid, t]) => {
            const thumb = hashOf(outcomes, t.ref);
            const hash = record?.hashes?.[cid];
            return thumb && hash ? [{ cid, hash, thumb, width: t.width, height: t.height }] : [];
          }),
          recipe,
        };
        ctx.commit();
        let answer: ResEntryChangeV2;
        try {
          answer = await api.post<ResEntryChangeV2>("/sdapi/v2/library", body);
        } catch (err) {
          const misses = missingHashes(err);
          if (!misses) throw err;
          await ctx.batch.again({}, misses).run();
          answer = await api.post<ResEntryChangeV2>("/sdapi/v2/library", body);
        }
        applyEntry(
          answer.entry,
          answer.pushed_out.map((p) => p.id),
        );
        const notes = [
          movedText(answer),
          await modelsNote(answer.entry.recipe),
          portable.leftOut.length > 0 ? settingsLeftOutText(portable.leftOut) : null,
        ].filter((n) => n !== null);
        toast.success(savedText(answer.entry.name), {
          id: toastId,
          cancel: undefined,
          description: notes.length > 0 ? notes.join(". ") : undefined,
          action: { label: SHOW_IN_LIBRARY, onClick: () => showLibrary() },
        });
        return answer.entry;
      },
      { transient: false, cancelled: UPLOAD_STOPPED, failed: SAVE_FAILED },
    );
  } catch (err) {
    console.error("[recipes] could not save", err);
    toast.dismiss(toastId);
    refused(err, SAVE_FAILED);
    return null;
  } finally {
    unfollow();
    useLibrarySaving.setState((s) => ({ saving: s.saving - 1 }));
  }
}

/** An entry from the server with its recipe read; throws with words for a
 * recipe gone, in the trash, or saved by a newer build. */
export async function readRecipeEntry(id: string): Promise<{ entry: ResEntryV2; recipe: Recipe }> {
  let entry: ResEntryV2;
  try {
    entry = await api.get<ResEntryV2>(`/sdapi/v2/library/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err instanceof ApiError && err.code === "gone") {
      void queryClient.invalidateQueries({ queryKey: LIBRARY_KEY });
      throw new Error(NO_LONGER_IN_LIBRARY, { cause: err });
    }
    throw err;
  }
  if (entry.trashed_at != null) throw new Error(inTrashText(entry.name));
  return { entry, recipe: readRecipe(entry.recipe) };
}

/** A recipe's frames with their bytes, fetched where this browser lacks them;
 * its maps current again. Restoring them counts as using the entry. */
async function entryInputs(entry: ResEntryV2, fetch: FetchOptions): Promise<LoadedInputs | null> {
  if (!entry.inputs) return null;
  const stored = readStoredInputs(entry.inputs);
  const { blobs } = await bytesFor(
    [...stored.cids, ...Object.values(entry.maps)],
    entry.hashes,
    fetch,
  );
  const joined = joinInputs(stored.inputs, blobs);
  await installEntryMaps(entry.maps, blobs);
  touchEntry(entry.id);
  const maps = new Map<string, { cid: string; blob: Blob }>();
  for (const [key, cid] of Object.entries(entry.maps)) {
    const blob = blobs.get(cid);
    if (blob) maps.set(key, { cid, blob });
  }
  return { ...joined, maps };
}

/** A library recipe as the Restore dialog reads it: its settings snapshot,
 * its frames landing as a recall does, and its model. */
export async function entryTarget(id: string): Promise<RestoreTarget> {
  const { entry, recipe } = await readRecipeEntry(id);
  const { settings, skipped } = readSettings(recipe.settings, defaultParams);
  return {
    name: entry.name,
    settings: { ok: true, extracted: { params: settings, img2img: {}, notes: [] }, skipped },
    inputs: (fetch) => entryInputs(entry, fetch),
    model: recipe.checkpoint,
    place: "recall",
    inputsReason: entry.inputs ? null : "recipeNoInputs",
  };
}

/** A recipe as a record Run sends again, with the request's uploads the server lacks. */
async function loadOf(entry: ResEntryV2, recipe: Recipe): Promise<RecordLoad> {
  const hashes = requestHashes(recipe);
  const answer = await claim(hashes, 0, { keep: false });
  return recipeLoad(
    {
      id: entry.id,
      savedAt: entry.saved_at,
      inputs: entry.inputs ? readStoredInputs(entry.inputs).inputs : null,
      maps: entry.maps,
      hashes: entry.hashes,
      lost: entry.lost,
      unavailable: entry.unavailable,
    },
    recipe,
    new Set([...answer.missing, ...answer.lost]),
  );
}

/** Run a recipe as it is: its model loaded first in queue order when this
 * server has the file, else on the loaded model with a note; a refused load
 * sends nothing. Null when it was not sent; the reason is told. */
export async function runRecipe(id: string): Promise<Job | null> {
  if (useRecipeRuns.getState().running.has(id)) return null;
  setRunning(id, true);
  const abort = new AbortController();
  const toastId = `recipe-run-${id}`;
  try {
    let read: { entry: ResEntryV2; recipe: Recipe };
    try {
      read = await readRecipeEntry(id);
    } catch (err) {
      toast.error(READ_RECIPE_FAILED, {
        id: toastId,
        description: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    const { entry, recipe } = read;
    const load = await loadOf(entry, recipe);
    const problem = replayProblem({
      domain: "generate",
      missingRefs: load.missingRefs.length,
      hasInputs: entry.inputs !== null,
    });
    if (problem === "gone") {
      toast.error(RUN_RECIPE_FAILED, { id: toastId, description: reasonText("gone") });
      return null;
    }
    const gone = problem === "remake" ? await goneForGood(load) : null;
    if (gone) {
      toast.error(RUN_RECIPE_FAILED, { id: toastId, description: replayMissingText(gone) });
      return null;
    }
    let loads: string | null = null;
    if (recipe.checkpoint) {
      const first = await modelFirst(recipe.checkpoint);
      if (first.kind === "loads") loads = first.model;
      else if (first.kind === "other") {
        toast.info(runsOnLoadedText(recipe.checkpoint.name, first.state));
      }
    }
    const batch = new UploadBatch("Run recipe", {
      signal: abort.signal,
      onProgress: (p) => {
        if (p.phase !== "claiming" && p.files > 0) {
          toast.loading(batchText(p.done, p.files, p.sent, p.total), {
            id: toastId,
            cancel: { label: CANCEL, onClick: () => abort.abort() },
          });
        }
      },
    });
    const job = await submitJob(replaySubmission(load, batch));
    touchEntry(id);
    toast.success(RECIPE_QUEUED, {
      id: toastId,
      cancel: undefined,
      description: loads ? loadingForText(loads, entry.name) : undefined,
    });
    return job;
  } catch (err) {
    if (err instanceof UserAbortError) {
      toast.info(UPLOAD_CANCELLED, { id: toastId, cancel: undefined });
      return null;
    }
    toast.error(RUN_RECIPE_FAILED, {
      id: toastId,
      cancel: undefined,
      description: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    setRunning(id, false);
  }
}
