import { useEffect, useRef } from "react";
import { api } from "@/api/client";
import {
  useJobQueueStore,
  type JobDomain,
  type JobSnapshot,
  type TrackedJob,
} from "@/stores/jobStore";
import { getAllJobPayloads, type StoredJobPayload } from "@/lib/jobPayloadDb";
import type { Job, JobListResponse } from "@/api/types/v2";

const JOB_TYPE_TO_DOMAIN: Record<string, JobDomain> = {
  generate: "generate",
  upscale: "upscale",
  video: "video",
  framepack: "framepack",
  ltx: "ltx",
  "xyz-grid": "xyz-grid",
};

function jobToDomain(type: string): JobDomain {
  return JOB_TYPE_TO_DOMAIN[type] ?? "generate";
}

// Pre-Phase-6 persisted records lack a `kind` discriminator. Guess from the
// domain: canvas-rooted jobs (generate, xyz-grid) get `control` with no
// preserved inputs; everything else (upscale, rembg, video, framepack, ltx)
// is self-contained in the request payload and gets `none`.
function defaultSnapshot(domain: JobDomain): JobSnapshot {
  if (domain === "generate" || domain === "xyz-grid") {
    return { kind: "control", controlUnits: [] };
  }
  return { kind: "none" };
}

function buildTrackedJob(backendJob: Job, local: StoredJobPayload | undefined): TrackedJob {
  const domain = local?.domain ?? jobToDomain(backendJob.type);
  return {
    id: backendJob.id,
    domain,
    status: backendJob.status,
    progress: backendJob.progress ?? 0,
    eta: backendJob.eta ?? 0,
    step: backendJob.step ?? 0,
    steps: backendJob.steps ?? 0,
    task: "",
    textinfo: null,
    previewUrl: null,
    result: backendJob.result ?? null,
    error: backendJob.error ?? null,
    createdAt: backendJob.created_at ? new Date(backendJob.created_at).getTime() : Date.now(),
    snapshot: local?.snapshot ?? defaultSnapshot(domain),
    request: local?.request ?? null,
    priority: local?.priority ?? 0,
    stage: 0,
    stageName: "",
    stageCount: 0,
    phase: null,
    stages: [],
  };
}

export function useJobRehydration() {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    void (async () => {
      try {
        const payloads = await getAllJobPayloads();
        const payloadMap = new Map<string, StoredJobPayload>();
        for (const p of payloads) payloadMap.set(p.id, p);

        const [pending, running] = await Promise.all([
          api.get<JobListResponse>("/sdapi/v2/jobs", { status: "pending", limit: "50" }),
          api.get<JobListResponse>("/sdapi/v2/jobs", { status: "running", limit: "10" }),
        ]);

        const backendJobs = [...pending.items, ...running.items];
        const store = useJobQueueStore.getState();

        for (const bj of backendJobs) {
          if (store.jobs.has(bj.id)) continue;
          const local = payloadMap.get(bj.id);
          const tracked = buildTrackedJob(bj, local);
          store.rehydrateJob(tracked);
        }

        // Terminal jobs' IDB payloads are intentionally NOT pruned here --
        // HistoryTab retry depends on the request shape surviving reload.
        // putJobPayload's LRU cap (MAX_PAYLOADS) keeps growth bounded.
      } catch {
        // Rehydration is best-effort; silently skip on error
      }
    })();
  }, []);
}
