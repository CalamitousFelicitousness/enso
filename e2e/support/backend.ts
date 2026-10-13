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

/** The name the server saved a job's first image under. */
export async function savedName(request: APIRequestContext, job: Job): Promise<string> {
  const url = job.result?.images[0]?.url ?? "";
  const answer = await request.get(url);
  expect(answer.ok(), `GET ${url} answered ${answer.status()}`).toBe(true);
  const disposition = answer.headers()["content-disposition"] ?? "";
  // Starlette encodes the name (filename*) only when it needs encoding
  const encoded = /filename\*=utf-8''([^;]+)/i.exec(disposition)?.[1];
  const name = encoded ? decodeURIComponent(encoded) : /filename="([^"]+)"/i.exec(disposition)?.[1];
  expect(name, `a file name in "${disposition}"`).toBeTruthy();
  return name ?? "";
}

export interface ListedFile {
  /** The label of the Gallery folder whose tree holds it. */
  label: string;
  path: string;
  /** Every path in that folder's tree. */
  tree: string[];
}

/** Where the Gallery lists a file of this name. */
export async function findOutput(request: APIRequestContext, name: string): Promise<ListedFile> {
  const roots = (await (await request.get("/sdapi/v2/browser/folders")).json()) as {
    path: string;
    label: string;
  }[];
  for (const root of roots) {
    const answer = await request.get("/sdapi/v2/browser/files", { params: { folder: root.path } });
    if (!answer.ok()) continue;
    // a listing entry is the folder and the path under it, each encoded
    const tree = ((await answer.json()) as string[]).map((entry) => {
      const [folder = "", relative = ""] = entry.split("##F##");
      return `${decodeURIComponent(folder).replace(/\/+$/, "")}/${decodeURIComponent(relative)}`;
    });
    const path = tree.find((p) => p.split("/").pop() === name);
    if (path) return { label: root.label, path, tree };
  }
  throw new Error(`no Gallery folder holds ${name}`);
}

/** Delete a file a spec made, from its folder or from the Gallery trash, with
 * the files saved beside it. */
export async function deleteOutput(request: APIRequestContext, path: string): Promise<void> {
  const trash = (await (await request.get("/sdapi/v2/browser/trash")).json()) as {
    items: { id: string; name: string; folder: string }[];
  };
  const ids = trash.items.filter((i) => `${i.folder}/${i.name}` === path).map((i) => i.id);
  if (ids.length > 0) await request.post("/sdapi/v2/browser/trash/delete", { data: { ids } });
  await request.post("/sdapi/v2/browser/delete", { data: { files: [path] } });
}
