// Making maps outside a generation: "Process now" queues a preprocess job
// over a frame's pictures as the request would send them, and the maps a
// job reports (this one's or a generation's pre-step) are fetched into the
// cache. The one outline fix that runs a job lives here too.

import { toast } from "sonner";
import { api } from "@/api/client";
import type { Job, PreprocessItem, PreprocessJobParams } from "@/api/types/v2";
import { flattenCanvas } from "@/lib/flattenCanvas";
import { putJobPayload } from "@/lib/jobPayloadDb";
import { uploadBlob } from "@/lib/upload";
import { fixRunsJob } from "@/lib/inputs/problems";
import {
  computeOutline,
  type MapSlot,
  type Outline,
  type OutlineEnv,
  type OutlineProblem,
} from "@/lib/inputs/outline";
import { positionsLabel, processOutcomeText, type ProcessOutcome } from "@/lib/inputs/text";
import { composedPictures, type Frame } from "@/lib/inputs/types";
import { useInputStore } from "@/stores/inputStore";
import { useJobQueueStore } from "@/stores/jobStore";
import { installMap, lookupMaps, markFailed, useMapStore } from "./maps";

/** A map slot with the frame it belongs to and, for a Reference picture, which one. */
export interface SlotOwner {
  slot: MapSlot;
  frameId: string;
  pictureId: string | null;
  /** For a Control frame, the frame whose composite it sends. */
  sourceFrameId: string;
}

/** Every map slot of the outline with its owner, in send order. */
export function slotOwners(outline: Outline): SlotOwner[] {
  const owners: SlotOwner[] = [];
  for (const input of outline.sent) {
    if (input.map) {
      owners.push({
        slot: input.map,
        frameId: input.frameId,
        pictureId: input.pictureId,
        sourceFrameId: input.frameId,
      });
    }
  }
  for (const send of outline.controls) {
    if (send.map) {
      owners.push({
        slot: send.map,
        frameId: send.frameId,
        pictureId: null,
        sourceFrameId: send.sourceFrameId,
      });
    }
  }
  return owners;
}

/** The picture a slot's processor runs on, as the request sends it: a file
 * as it is, a composite drawn from its layers at the size it goes out at,
 * by the same call the request builder makes. */
export async function sourceBlob(frames: Frame[], owner: SlotOwner): Promise<Blob> {
  const { spec } = owner.slot;
  if (spec.kind === "file") {
    const picture = frames
      .find((f) => f.id === owner.frameId)
      ?.pictures.find((p) => p.id === owner.pictureId);
    if (!picture?.file) throw new Error("The picture could not be read");
    return picture.file;
  }
  const source = frames.find((f) => f.id === owner.sourceFrameId);
  if (!source) throw new Error("The frame is gone");
  const size = { width: spec.width, height: spec.height };
  const flat = await flattenCanvas(
    composedPictures(source),
    size.width,
    size.height,
    spec.out ?? size,
  );
  if (!flat) throw new Error("The frame holds no picture to process");
  return flat;
}

/** Make the maps the given frames need, in one queued job: those the cache
 * does not hold once it has answered, and no job is making. The keys and
 * the pictures come from one reading of the frames, so a map is always
 * stored under the key of the picture it was made from. */
export async function processFrames(
  env: OutlineEnv,
  frameIds: Iterable<string> | "all",
): Promise<ProcessOutcome> {
  if (!env.processing) return "unavailable";
  const frames = useInputStore.getState().frames;
  const wanted = frameIds === "all" ? null : new Set(frameIds);
  const owners = slotOwners(computeOutline(frames, env)).filter(
    (o) => wanted === null || wanted.has(o.frameId),
  );
  if (owners.length === 0) return "none";
  await lookupMaps(owners.map((o) => o.slot.key));
  const { current, pending } = useMapStore.getState();
  const missing = owners.filter((o) => !current.has(o.slot.key));
  const needed = [
    ...new Map(
      missing.filter((o) => !pending.has(o.slot.key)).map((o) => [o.slot.key, o]),
    ).values(),
  ];
  if (needed.length === 0) return missing.length === 0 ? "current" : "busy";
  try {
    const items: PreprocessItem[] = [];
    for (const owner of needed) {
      const ref = await uploadBlob(await sourceBlob(frames, owner), "source.png");
      items.push({
        image: ref,
        process: owner.slot.processor.id,
        params: owner.slot.params,
        key: owner.slot.key,
      });
    }
    const payload: PreprocessJobParams = { type: "preprocess", items };
    const job = await api.post<Job>("/sdapi/v2/jobs", payload);
    const snapshot = { kind: "maps" as const, mapKeys: items.map((i) => i.key) };
    useJobQueueStore.getState().trackJob(job.id, "preprocess", snapshot, payload);
    void putJobPayload({
      id: job.id,
      domain: "preprocess",
      request: payload,
      priority: 0,
      snapshot,
      createdAt: Date.now(),
    });
    return "started";
  } catch (err) {
    toast.error("Could not start processing", {
      description: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}

/** Fetch the maps a job reported into the cache, and note the failures. */
export async function installMaps(
  maps: Record<string, string>,
  failed: Record<string, string>,
): Promise<void> {
  markFailed(failed);
  const { current } = useMapStore.getState();
  await Promise.all(
    Object.entries(maps)
      .filter(([key]) => !current.has(key))
      .map(async ([key, url]) => {
        try {
          const response = await fetch(`${api.getBaseUrl()}${url}`, {
            headers: api.getAuthHeaders(),
          });
          if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
          await installMap(key, await response.blob());
        } catch (err) {
          console.error("[inputs] could not fetch a map the server made", err);
          markFailed({ [key]: "The map the server made could not be fetched" });
        }
      }),
  );
}

/** Process now, with the outcome said: `started` as given, a job that was
 * not needed as a notice, a start that failed by its own. */
export async function processNow(
  env: OutlineEnv,
  frameIds: Iterable<string> | "all",
  started: string | null = null,
): Promise<ProcessOutcome> {
  const outcome = await processFrames(env, frameIds);
  if (outcome === "started") {
    if (started) toast.info(started);
  } else if (outcome !== "failed") {
    toast.info(processOutcomeText(outcome));
  }
  return outcome;
}

/** Apply a problem's fix: a change to the frames, or the job that makes the
 * maps a model that runs elsewhere needs first. */
export function applyFix(env: OutlineEnv, problem: OutlineProblem): void {
  if (!fixRunsJob(problem)) {
    useInputStore.getState().fixProblem(problem);
    return;
  }
  const where = problem.code === "cloudMaps" ? positionsLabel(problem.positions) : "the inputs";
  void processNow(env, "all", `Processing ${where}`);
}
