// The jobs this browser sent that the server still holds when a page starts.
// Queued and running ones are tracked again; ones that ended while no page
// was open reach the strip once, oldest first, or show that they failed. A
// job this browser has no record of is the History tab's to show: the server
// is shared with other browsers.

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { Job, JobListResponse, JobRequest, JobStatus } from "@/api/types/v2";
import {
  adoptLegacyJob,
  loadJob,
  loadJobFacts,
  markRouted,
  retireJobRecords,
  useJobFacts,
} from "@/inputs/jobs";
import type { StoredJob } from "@/lib/inputs/stored";
import { isVideoDomain, stripDomain } from "@/lib/jobs/domains";
import { closedPageText, onStripText } from "@/lib/jobs/text";
import { useBackendStatusStore } from "@/stores/backendStatusStore";
import { historyHydrated, useGenerationStore } from "@/stores/generationStore";
import { inputsReady } from "@/stores/inputStore";
import { useJobQueueStore, type TrackedJob } from "@/stores/jobStore";
import { useVideoStore } from "@/stores/videoStore";
import { routeResult } from "./useJobTracker";

function list(status: JobStatus, limit: number): Promise<JobListResponse> {
  return api.get<JobListResponse>("/sdapi/v2/jobs", { status, limit: String(limit) });
}

const millis = (iso: string | null) => (iso ? new Date(iso).getTime() : Date.now());

function tracked(job: Job, record: StoredJob, endedWhileClosed: boolean): TrackedJob {
  const priority = record.request["priority"];
  return {
    id: job.id,
    domain: record.domain,
    status: job.status,
    progress: job.progress ?? 0,
    eta: job.eta ?? 0,
    step: job.step ?? 0,
    steps: job.steps ?? 0,
    task: "",
    textinfo: null,
    previewUrl: null,
    result: job.result ?? null,
    error: job.error ?? null,
    createdAt: record.createdAt,
    request: record.request as unknown as JobRequest,
    mapKeys: record.mapKeys,
    priority: typeof priority === "number" ? priority : 0,
    rehydrated: true,
    endedWhileClosed,
    stage: 0,
    stageName: "",
    stageCount: 0,
    phase: null,
    stages: [],
  };
}

/** Track the queued and running jobs this browser sent. */
async function trackLiveJobs(): Promise<void> {
  const [pending, running] = await Promise.all([list("pending", 50), list("running", 10)]);
  for (const job of [...pending.items, ...running.items]) {
    if (useJobQueueStore.getState().jobs.has(job.id)) continue;
    const record = useJobFacts.getState().facts.has(job.id)
      ? await loadJob(job.id)
      : await adoptLegacyJob(job.id);
    if (record) useJobQueueStore.getState().rehydrateJob(tracked(job, record, false));
  }
}

/** Route the jobs this browser sent that ended while no page was open: each
 * result once, the newest a strip keeps; a failed job is shown failed. One
 * notice says how many. */
async function routeEndedJobs(): Promise<void> {
  // Without the stored history it is not known which results the strips hold
  if (!(await historyHydrated())) return;
  const onStrip = new Set([
    ...useGenerationStore.getState().results.map((r) => r.id),
    ...useVideoStore.getState().results.map((r) => r.id),
  ]);
  const [completed, failed] = await Promise.all([list("completed", 50), list("failed", 50)]);
  const { facts } = useJobFacts.getState();
  const ended = [...completed.items, ...failed.items]
    .filter((job) => {
      const fact = facts.get(job.id);
      return (
        fact !== undefined &&
        !fact.routed &&
        stripDomain(fact.domain) &&
        !useJobQueueStore.getState().jobs.has(job.id) &&
        !onStrip.has(job.id)
      );
    })
    .sort((a, b) => millis(a.completed_at) - millis(b.completed_at));

  // Past a strip's limit the oldest are only marked, so they never arrive later
  const room = {
    image: useGenerationStore.getState().historyLimit,
    video: useVideoStore.getState().historyLimit,
  };
  const results = ended.filter((job) => job.status === "completed" && job.result);
  const strip = (job: Job) =>
    isVideoDomain(facts.get(job.id)?.domain ?? "generate") ? "video" : "image";
  const routed = new Set<string>();
  for (const job of [...results].reverse()) {
    const which = strip(job);
    if (room[which] > 0) {
      room[which] -= 1;
      routed.add(job.id);
    }
  }

  let finished = 0;
  let failures = 0;
  for (const job of ended) {
    const record = await loadJob(job.id);
    if (!record) continue;
    if (job.status === "completed" && job.result) {
      finished += 1;
      if (routed.has(job.id)) {
        await routeResult(
          { id: job.id, domain: record.domain, request: record.request as unknown as JobRequest },
          job.result,
          { completedAt: millis(job.completed_at), select: false },
        );
      } else {
        await markRouted(job.id);
      }
    } else if (job.status === "failed") {
      failures += 1;
      useJobQueueStore.getState().rehydrateJob(tracked(job, record, true));
      await markRouted(job.id);
    }
  }

  // Nothing was selected while the strip was empty: show the newest
  const gen = useGenerationStore.getState();
  if (gen.selectedResultId === null && gen.results[0]) gen.selectImage(gen.results[0].id, 0);

  const title = closedPageText(finished, failures);
  if (title) {
    toast.info(title, routed.size > 0 ? { description: onStripText(routed.size) } : undefined);
  }
}

/** Resolves once the global socket is connected, so a page opened while the
 * server restarts asks it once it answers. */
function serverAnswers(): Promise<void> {
  if (useBackendStatusStore.getState().connected) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = useBackendStatusStore.subscribe((state) => {
      if (!state.connected) return;
      unsubscribe();
      resolve();
    });
  });
}

async function rehydrate(): Promise<void> {
  // The database is open and swept once the stored inputs are in
  await inputsReady();
  await serverAnswers();
  await loadJobFacts();
  await trackLiveJobs();
  await routeEndedJobs();
  await retireJobRecords();
}

export function useJobRehydration() {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    rehydrate().catch((err: unknown) => {
      console.error("[jobs] could not pick up the jobs sent from this browser", err);
    });
  }, []);
}
