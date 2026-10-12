import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

export interface Checkpoint {
  loaded: boolean;
  name?: string | null;
  class_name?: string | null;
  max_input_images?: number | null;
  request_sets_size?: boolean | null;
  size_multiple?: number | null;
  strength_applicable?: boolean | null;
}

export interface JobImage {
  url: string;
  width: number;
  height: number;
}

export interface Job {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  error?: string | null;
  /** `maps`: the maps the job made before generating, by client key.
   * `params`: the request as the server stored it. `info`: what it recorded,
   * the seeds among it. */
  result?: {
    images: JobImage[];
    maps?: Record<string, string>;
    params?: Record<string, unknown>;
    info?: Record<string, unknown>;
  } | null;
}

export async function loadedCheckpoint(request: APIRequestContext): Promise<Checkpoint> {
  const res = await request.get("/sdapi/v2/checkpoint");
  expect(res.ok(), "GET /sdapi/v2/checkpoint").toBeTruthy();
  return (await res.json()) as Checkpoint;
}

/** Poll a job until it leaves the queue. A generation has no fixed duration:
 * a size the server has not run yet makes it retune its kernels first. */
export async function finishedJob(request: APIRequestContext, id: string): Promise<Job> {
  for (;;) {
    const res = await request.get(`/sdapi/v2/jobs/${id}`);
    expect(res.ok(), `GET /sdapi/v2/jobs/${id}`).toBeTruthy();
    const job = (await res.json()) as Job;
    if (job.status !== "pending" && job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

/** Sizes of a job's saved images, as WxH. */
export function imageSizes(job: Job): string[] {
  return (job.result?.images ?? []).map((image) => `${image.width}x${image.height}`);
}

/** The server log lines one job wrote, or null when SDNEXT_LOG is not set.
 * Any other process appending to that file lands in the slice too. */
export function jobLog(id: string): string[] | null {
  const path = process.env["SDNEXT_LOG"];
  if (!path) return null;
  const lines = readFileSync(path, "utf8").split("\n");
  const start = lines.findIndex((line) => line.includes(`Job queue: executing id=${id}`));
  if (start < 0) return [];
  const end = lines.findIndex(
    (line, index) => index > start && /Job queue: (completed|failed) id=/.test(line),
  );
  return lines.slice(start, end < 0 ? undefined : end + 1);
}

/** The pipeline call lines of a job: "Base", "Hires" or "Detail" with the
 * width and height sdnext passed. */
export function pipelineCalls(log: string[]): string[] {
  return log.flatMap((line) => {
    const call = /INFO\s+(Base|Hires|Detail): pipeline=/.exec(line);
    const width = /'width': (\d+)/.exec(line);
    const height = /'height': (\d+)/.exec(line);
    return call && width && height ? [`${call[1]} ${width[1]}x${height[1]}`] : [];
  });
}

export interface Upload {
  /** Null when the browser kept no answer body. */
  hash: string | null;
  size: number;
  /** The server had no copy of these bytes before. */
  created: boolean;
}

/** What a page sent the media store, in the order the answers came. */
export interface MediaTraffic {
  uploads: Upload[];
  /** Every hash a claim answered as held. */
  present: string[];
  /** The job of each submit. */
  jobs: Record<string, unknown>[];
  /** Wait for the answers still being read. */
  settled(): Promise<void>;
  clear(): void;
}

/** Record what a page sends the media store from now on. */
export function watchMedia(page: Page): MediaTraffic {
  const reading = new Set<Promise<void>>();
  const traffic: MediaTraffic = {
    uploads: [],
    present: [],
    jobs: [],
    settled: async () => {
      await Promise.all(reading);
    },
    clear: () => {
      traffic.uploads = [];
      traffic.present = [];
      traffic.jobs = [];
    },
  };
  page.on("response", (response) => {
    const request = response.request();
    if (request.method() !== "POST" || !response.ok()) return;
    const path = new URL(response.url()).pathname;
    let read: Promise<void> | null = null;
    if (path === "/sdapi/v2/blobs") {
      // The browser keeps no answer body for a 60 MB upload, so the size and the
      // outcome come from the request and the status
      read = Promise.all([
        request.headerValue("content-length"),
        response.json().catch(() => null),
      ]).then(([length, body]) => {
        traffic.uploads.push({
          hash: (body as { hash?: string } | null)?.hash ?? null,
          size: Number(length),
          created: response.status() === 201,
        });
      });
    } else if (path === "/sdapi/v2/blobs/claim") {
      read = response.json().then((body) => {
        traffic.present.push(...(body as { present: string[] }).present);
      });
    } else if (path === "/sdapi/v2/submit") {
      traffic.jobs.push((request.postDataJSON() as { job: Record<string, unknown> }).job);
    }
    if (!read) return;
    const done = read.catch(() => {}).finally(() => reading.delete(done));
    reading.add(done);
  });
  return traffic;
}

/** The SHA-256 the media store names a file's bytes by. */
export function fileHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
