// Server outputs: the id in an output's durable URL, and the job that made a
// Gallery file.

import { api } from "./client";
import type { ResOutputJobV2 } from "./types/media";

const OUTPUT_ID = /\/sdapi\/v2\/outputs\/([0-9a-f]{16})(?:[?#].*)?$/;

/** The id in an output's durable URL; null for a job-scoped URL or raw base64. */
export function outputIdOf(url: string): string | null {
  return OUTPUT_ID.exec(url)?.[1] ?? null;
}

/** The job that made a Gallery file: the stamp in its text, else the outputs table. */
export function outputJob(path: string): Promise<ResOutputJobV2> {
  return api.get<ResOutputJobV2>("/sdapi/v2/browser/job", { file: path });
}
