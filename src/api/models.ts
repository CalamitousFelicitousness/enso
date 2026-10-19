// Model operations outside React.

import { api } from "./client";
import type { Job } from "./types/v2";

/** Queue a load of the checkpoint, so it runs after the jobs already queued
 * and before the ones that follow. */
export function queueModelLoad(title: string): Promise<Job> {
  return api.post<Job>("/sdapi/v2/jobs", { type: "model-load", sd_model_checkpoint: title });
}
