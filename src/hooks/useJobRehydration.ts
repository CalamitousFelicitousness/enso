// The jobs this browser sent that the server still holds when a page starts.
// Queued and running ones are tracked again; ones that ended while no page
// was open reach the strip once, oldest first, or show that they failed. A
// job whose record names another browser is the History tab's to show: the
// server is shared.

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/api/client";
import { queryClient } from "@/api/queryClient";
import { recordKey, retryUnlessRefused } from "@/api/queryKeys";
import { clientRecords } from "@/api/records";
import type { Job, JobListResponse, JobRequest, JobStatus } from "@/api/types/v2";
import { clientId } from "@/inputs/client";
import { loadFacts } from "@/inputs/facts";
import { loadRecord, markRouted, retireSnapshots } from "@/inputs/jobs";
import { legacyUnrouted } from "@/inputs/legacyRecords";
import type { StoredJob } from "@/lib/inputs/stored";
import { asJobDomain, isVideoDomain, stripDomain, type JobDomain } from "@/lib/jobs/domains";
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
  const priority = job.priority ?? record.request["priority"];
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

const isLive = (status: JobStatus) => status === "pending" || status === "running";

/** Track a queued or running job from its record. */
async function track(job: Job): Promise<void> {
  if (useJobQueueStore.getState().jobs.has(job.id)) return;
  const load = await loadRecord(job.id).catch((err: unknown) => {
    console.warn(`[jobs] the record of ${job.id} could not be read`, err);
    return null;
  });
  if (load) useJobQueueStore.getState().rehydrateJob(tracked(job, load.record, false));
}

/** Track the queued and running jobs whose records name this browser. */
async function trackLiveJobs(): Promise<void> {
  const [pending, running] = await Promise.all([list("pending", 50), list("running", 10)]);
  const live = [...pending.items, ...running.items].filter(
    (job) => !useJobQueueStore.getState().jobs.has(job.id),
  );
  // one read for every card and this pass: the facts share the cards' cache
  const facts = await Promise.all(
    live.map((job) =>
      queryClient
        .fetchQuery({
          queryKey: recordKey(job.id),
          queryFn: () => loadFacts(job.id),
          staleTime: Infinity,
          retry: retryUnlessRefused,
        })
        .catch(() => null),
    ),
  );
  for (const [i, job] of live.entries()) {
    if (facts[i]?.mine) await track(job);
  }
}

interface Candidate {
  id: string;
  domain: JobDomain;
}

/** This browser's records of strip jobs whose results have not arrived, on
 * the server and in an older build's store. */
async function unroutedCandidates(): Promise<Candidate[]> {
  const found = new Map<string, Candidate>();
  const server = await clientRecords(await clientId(), false).catch((err: unknown) => {
    console.warn("[jobs] could not read this browser's records", err);
    return [];
  });
  for (const item of server) {
    const domain = asJobDomain(item.domain);
    if (domain && stripDomain(domain)) found.set(item.job_id, { id: item.job_id, domain });
  }
  for (const record of await legacyUnrouted()) {
    if (!found.has(record.id)) found.set(record.id, { id: record.id, domain: record.domain });
  }
  return [...found.values()];
}

/** Route the jobs this browser sent that ended while no page was open: each
 * result once, the newest a strip keeps; a failed job is shown failed. A
 * record whose job the server no longer has is marked routed, never one that
 * is only missing from a list the server caps. One notice says how many. */
async function routeEndedJobs(): Promise<void> {
  // Without the stored history it is not known which results the strips hold
  if (!(await historyHydrated())) return;
  const onStrip = new Set([
    ...useGenerationStore.getState().results.map((r) => r.id),
    ...useVideoStore.getState().results.map((r) => r.id),
  ]);
  const [completed, failed] = await Promise.all([list("completed", 50), list("failed", 50)]);
  const listed = new Map([...completed.items, ...failed.items].map((job) => [job.id, job]));

  const ended: { job: Job; domain: JobDomain }[] = [];
  for (const candidate of await unroutedCandidates()) {
    if (useJobQueueStore.getState().jobs.has(candidate.id)) continue;
    if (onStrip.has(candidate.id)) {
      await markRouted(candidate.id);
      continue;
    }
    let job = listed.get(candidate.id);
    if (!job) {
      try {
        job = await api.get<Job>(`/sdapi/v2/jobs/${encodeURIComponent(candidate.id)}`);
      } catch (err) {
        // purged after its retention: its result is not coming
        if (err instanceof ApiError && err.status === 404) await markRouted(candidate.id);
        continue;
      }
    }
    if (isLive(job.status)) await track(job);
    else if (job.status === "completed" || job.status === "failed") {
      ended.push({ job, domain: candidate.domain });
    } else await markRouted(candidate.id);
  }
  ended.sort((a, b) => millis(a.job.completed_at) - millis(b.job.completed_at));

  // Past a strip's limit the oldest are only marked, so they never arrive later
  const room = {
    image: useGenerationStore.getState().historyLimit,
    video: useVideoStore.getState().historyLimit,
  };
  const strip = (domain: JobDomain) => (isVideoDomain(domain) ? "video" : "image");
  const routed = new Set<string>();
  for (const { job, domain } of [...ended].reverse()) {
    if (job.status !== "completed" || !job.result) continue;
    const which = strip(domain);
    if (room[which] > 0) {
      room[which] -= 1;
      routed.add(job.id);
    }
  }

  let finished = 0;
  let failures = 0;
  for (const { job } of ended) {
    const load = await loadRecord(job.id).catch(() => null);
    if (!load) continue;
    const { record } = load;
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
  await trackLiveJobs();
  await routeEndedJobs();
  await retireSnapshots();
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
