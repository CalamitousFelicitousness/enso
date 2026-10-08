import { useEffect, useRef } from "react";
import { api } from "@/api/client";
import { WebSocketManager } from "@/api/websocket";
import { useJobQueueStore, type TrackedJob } from "@/stores/jobStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useVideoStore } from "@/stores/videoStore";
import { useProcessStore } from "@/stores/processStore";
import { markRouted } from "@/inputs/jobs";
import { installMaps } from "@/inputs/processing";
import { isTerminal, isVideoDomain } from "@/lib/jobs/domains";
import { previewMimeType } from "@/lib/image";
import type { JobResult, JobWsEvent } from "@/api/types/v2";
import { toast } from "sonner";

const MAX_CONCURRENT_WS = 5;

/** This browser has dealt with the job's end, so a later page start leaves it be. */
function settle(jobId: string): void {
  markRouted(jobId).catch((err: unknown) => {
    console.error("[jobs] could not mark a job's record", err);
  });
}

/** A job the user cancelled: the page's copy says so. Safe to call twice. */
export function markJobCancelled(jobId: string): void {
  useJobQueueStore.getState().updateStatus(jobId, "cancelled");
  settle(jobId);
}

export interface RouteOptions {
  /** When the job ended, for a result routed after the fact. */
  completedAt?: number;
  /** Move the strip's selection to the result. */
  select?: boolean;
}

/** Hand a completed job's result to the view that shows it, under the job's
 * id, and mark the job's record once the result is stored: a result routed
 * twice, by two tabs or a page start, takes one place. */
export async function routeResult(
  job: Pick<TrackedJob, "id" | "domain" | "request">,
  result: JobResult,
  options: RouteOptions = {},
): Promise<void> {
  const { id, domain } = job;
  const timestamp = options.completedAt ?? Date.now();
  const select = options.select !== false;
  try {
    if (domain === "generate") {
      // The maps event carried these already, unless the page joined the job late
      if (result.maps) void installMaps(result.maps, {});
      if (result.images.length > 0) {
        await useGenerationStore.getState().addResult(
          {
            id,
            jobId: id,
            type: job.request?.type ?? "generate",
            images: result.images.map((img) => img.url),
            // Server returns snake_case JSON; the structural assignment to
            // WireParams here crosses the wire-contract boundary.
            parameters: result.params,
            info: JSON.stringify(result.info),
            timestamp,
            warnings: result.warnings,
          },
          { select },
        );
      }
    } else if (domain === "preprocess") {
      if (result.maps) void installMaps(result.maps, {});
    } else if (isVideoDomain(domain)) {
      // Every video executor populates result.videos with a single VideoRef
      // carrying its own thumbnail_url.
      const vid = result.videos?.[0];
      const info: Record<string, unknown> = result.info ?? {};
      const infoFps = typeof info["fps"] === "number" && info["fps"] > 0 ? info["fps"] : null;
      const infoFrames =
        typeof info["frames"] === "number" && info["frames"] > 0 ? info["frames"] : null;
      const infoAudio = typeof info["has_audio"] === "boolean" ? info["has_audio"] : false;
      if (vid) {
        // Stored relative and resolved at render, like image results, so
        // persisted history survives a backend URL change.
        await useVideoStore.getState().addResult(
          {
            id,
            videoUrl: vid.url,
            thumbnailUrl: vid.thumbnail_url ?? undefined,
            width: vid.width,
            height: vid.height,
            format: vid.format,
            size: vid.size,
            duration: vid.duration,
            fps: infoFps,
            frames: infoFrames,
            hasAudio: infoAudio,
            // Server returns snake_case JSON; the structural assignment to
            // VideoWireParams here crosses the wire-contract boundary.
            params: result.params,
            domain: domain,
            timestamp,
          },
          { select },
        );
      }
    } else if (domain === "process" || domain === "upscale" || domain === "rembg") {
      const base = api.getBaseUrl();
      const vid = result.videos?.[0];
      const info = result.info?.["postprocessing"];
      useProcessStore.getState().setResults(
        result.images.map((img) => ({
          url: `${base}${img.url}`,
          width: img.width,
          height: img.height,
        })),
        vid
          ? {
              url: `${base}${vid.url}`,
              width: vid.width,
              height: vid.height,
              duration: vid.duration,
            }
          : null,
        typeof info === "string" && info ? info : null,
      );
    }
  } catch (err) {
    // left unmarked, so the next page start routes it again
    console.error("[jobs] could not store a job's result", err);
    return;
  }
  settle(id);
}

interface WsEntry {
  manager: WebSocketManager;
  offMessage: () => void;
  offBinary: () => void;
}

let wsMapInstance: Map<string, WsEntry> | null = null;

export function sendToJob(jobId: string, data: Record<string, unknown>) {
  wsMapInstance?.get(jobId)?.manager.send(data);
}

export function useJobTracker() {
  const wsMap = useRef(new Map<string, WsEntry>());

  useEffect(() => {
    wsMapInstance = wsMap.current;
    return () => {
      wsMapInstance = null;
    };
  }, []);

  useEffect(() => {
    const currentWsMap = wsMap.current;
    const unsub = useJobQueueStore.subscribe((state, prev) => {
      if (state.jobs === prev.jobs) return;

      const store = useJobQueueStore.getState();
      const currentMap = currentWsMap;

      // Close WS for jobs that are gone or terminal
      for (const [id, entry] of currentMap) {
        const job = store.jobs.get(id);
        if (!job || isTerminal(job.status)) {
          entry.offMessage();
          entry.offBinary();
          entry.manager.disconnect();
          currentMap.delete(id);
        }
      }

      // Open WS for non-terminal jobs that don't have one yet
      const nonTerminal = Array.from(store.jobs.values())
        .filter((j) => !isTerminal(j.status) && !currentMap.has(j.id))
        .sort((a, b) => b.createdAt - a.createdAt);

      const slotsAvailable = MAX_CONCURRENT_WS - currentMap.size;
      const toOpen = nonTerminal.slice(0, Math.max(0, slotsAvailable));

      for (const job of toOpen) {
        const wsUrl = api.getWebSocketUrl(`/sdapi/v2/jobs/${job.id}/ws`);
        const manager = new WebSocketManager(wsUrl, () => api.getWsTicket());
        const jobId = job.id;

        const offMessage = manager.on("message", (raw: unknown) => {
          const data = raw as JobWsEvent;
          const s = useJobQueueStore.getState();
          switch (data.type) {
            case "stages":
              s.setStages(jobId, data.stages);
              break;
            case "progress":
              s.updateProgress(
                jobId,
                data.progress,
                data.eta ?? 0,
                data.step,
                data.steps,
                data.task,
                data.textinfo,
                data.stage,
                data.stage_name,
                data.stage_count,
                data.phase,
              );
              break;
            case "cloud_progress":
              s.updateProgress(
                jobId,
                data.progress ?? 0,
                0,
                0,
                0,
                undefined,
                data.detail,
                undefined,
                undefined,
                undefined,
                data.phase,
              );
              break;
            case "status":
              // A job that ended with a result or an error says so again in
              // the event that carries it; taken from here, the socket would
              // close before that event is read
              if (data.status !== "completed" && data.status !== "failed") {
                s.updateStatus(jobId, data.status);
              }
              break;
            case "maps":
              void installMaps(data.maps, data.failed);
              break;
            case "completed": {
              s.completeJob(jobId, data.result);
              const tracked = s.jobs.get(jobId);
              if (tracked) void routeResult(tracked, data.result);
              break;
            }
            case "error":
              s.failJob(jobId, data.error);
              toast.error(
                s.jobs.get(jobId)?.domain === "preprocess"
                  ? "Processing failed"
                  : "Generation failed",
                { description: data.error, duration: 8000 },
              );
              settle(jobId);
              break;
            case "cancelled":
              markJobCancelled(jobId);
              break;
          }
        });

        const offBinary = manager.on("binary", (buf: ArrayBuffer) => {
          const blob = new Blob([buf], { type: previewMimeType(buf) });
          const url = URL.createObjectURL(blob);
          useJobQueueStore.getState().updatePreview(jobId, url);
        });

        currentMap.set(jobId, { manager, offMessage, offBinary });
        manager.connect();
      }
    });

    return () => {
      unsub();
      for (const [, entry] of currentWsMap) {
        entry.offMessage();
        entry.offBinary();
        entry.manager.disconnect();
      }
      currentWsMap.clear();
    };
  }, []);
}
