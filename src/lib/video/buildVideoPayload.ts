import { uploadFile } from "@/lib/upload";
import { useVideoStore } from "@/stores/videoStore";
import { getVideoInputs } from "@/lib/video/inputs";
import { VIDEO_PARAM_KEYS, wireKeyFor, type VideoJobType } from "@/lib/video/paramRegistry";
import type { JobRequest } from "@/api/types/v2";
import type { LocalVideoEngineKind, LocalVideoModel } from "@/api/types/cloud";
import type { VideoModelCaps } from "@/api/types/video";

const KIND_TO_JOB: Record<LocalVideoEngineKind, VideoJobType> = {
  generic: "video",
  ltx: "ltx",
  framepack: "framepack",
};

export function jobTypeForKind(kind: LocalVideoEngineKind): VideoJobType {
  return KIND_TO_JOB[kind];
}

/** Build the job payload for a local video model by walking the param
 * registry; the per-job wire maps decide which store params ride along.
 * Pass the resolved caps (live query first) - the snapshot on `model` is
 * stale for selections persisted before the caps join existed. */
export async function buildVideoPayload(
  kind: LocalVideoEngineKind,
  model: LocalVideoModel,
  caps: VideoModelCaps | null = model.caps,
): Promise<JobRequest> {
  const job = KIND_TO_JOB[kind];
  const state = useVideoStore.getState();

  const payload: Record<string, unknown> = { type: job };
  if (job === "video") {
    payload["engine"] = model.engine;
    payload["model"] = model.model;
  } else if (job === "ltx") {
    payload["model"] = model.model;
  } else {
    payload["variant"] = model.model;
  }

  for (const key of VIDEO_PARAM_KEYS) {
    const wireKey = wireKeyFor(key, job);
    if (wireKey) payload[wireKey] = state[key];
  }

  // Caps-gated input attachment: slots the model ignores stay off the wire
  // even when stale frames linger on the canvas.
  const { init, last, refs } = getVideoInputs();
  const wantInit = caps ? caps.init_image !== "ignored" : true;
  const wantLast = caps ? caps.last_image !== "ignored" : true;
  const wantRefs = job === "video" && (caps?.references.supported ?? false);
  const initRef = wantInit && init ? await uploadFile(init) : null;
  const lastRef = wantLast && last ? await uploadFile(last) : null;
  if (job === "ltx") {
    payload["condition_image"] = initRef;
    payload["condition_last"] = lastRef;
  } else if (job === "framepack") {
    payload["init_image"] = initRef;
    payload["end_image"] = lastRef;
  } else {
    payload["init_image"] = initRef;
    payload["last_image"] = lastRef;
    const maxRefs = caps ? caps.references.max_total || caps.references.max_images : refs.length;
    payload["references"] = wantRefs
      ? await Promise.all(refs.slice(0, maxRefs || refs.length).map((f) => uploadFile(f)))
      : [];
  }

  // Every key written above is a wire key of this job's params model; the
  // registry's typed WireMap is what makes this cast sound.
  return payload as unknown as JobRequest;
}
