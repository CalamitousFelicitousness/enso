// Making maps outside a generation: "Process now" queues a preprocess job
// over a frame's pictures as the request would send them, and the maps a
// job reports (this one's or a generation's pre-step) are fetched into the
// cache. The one outline fix that runs a job lives here too.

import { toast } from "sonner";
import { fetchMedia } from "@/api/session";
import type { PreprocessItem, PreprocessJobParams } from "@/api/types/v2";
import { fixRunsJob } from "@/lib/inputs/problems";
import {
  computeOutline,
  type MapSlot,
  type Outline,
  type OutlineEnv,
  type OutlineProblem,
} from "@/lib/inputs/outline";
import { positionsLabel, processOutcomeText, type ProcessOutcome } from "@/lib/inputs/text";
import { useInputStore } from "@/stores/inputStore";
import { submitJob } from "./jobs";
import { installMap, lookupMaps, markFailed, useMapStore } from "./maps";
import { createUploader, type Uploader } from "./materialise";

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
 * as it is, a composite drawn from its layers at the size it goes out at. */
function sourceRef(up: Uploader, owner: SlotOwner): Promise<string> {
  const { spec } = owner.slot;
  if (spec.kind === "file") return up.file(owner.frameId, owner.pictureId ?? "");
  const drawnAt = spec.out ?? { width: spec.width, height: spec.height };
  return up.composite(owner.sourceFrameId, drawnAt).then((done) => done.ref);
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
    const up = createUploader({ frames, size: env.processing.frame });
    const items: PreprocessItem[] = [];
    for (const owner of needed) {
      items.push({
        image: await sourceRef(up, owner),
        process: owner.slot.processor.id,
        params: owner.slot.params,
        key: owner.slot.key,
      });
    }
    const request: PreprocessJobParams = { type: "preprocess", items };
    // Process now again is how these maps are made again, so the frames are not kept
    await submitJob({
      domain: "preprocess",
      request,
      ledger: up.ledger,
      inputs: null,
      mapKeys: items.map((i) => i.key),
      checkpoint: null,
    });
    return "started";
  } catch (err) {
    toast.error("Could not start processing", {
      description: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}

// A job reports its maps twice (the maps event, then its result); the second
// report must join the first one's fetch, not store the bytes again.
const installing = new Map<string, Promise<void>>();

async function fetchAndInstall(key: string, url: string): Promise<void> {
  try {
    const response = await fetchMedia(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    await installMap(key, await response.blob());
  } catch (err) {
    console.error("[inputs] could not fetch a map the server made", err);
    markFailed({ [key]: "The map the server made could not be fetched" });
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
      .map(([key, url]) => {
        let pending = installing.get(key);
        if (!pending) {
          pending = fetchAndInstall(key, url).finally(() => installing.delete(key));
          installing.set(key, pending);
        }
        return pending;
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
