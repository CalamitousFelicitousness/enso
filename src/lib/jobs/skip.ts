// Whether Skip can act on a running generate job. Skip drops the image in
// progress and the job goes on. While the server makes the job's maps there
// is no image in progress, and a map cannot be skipped: every image uses it.

export interface SkipFacts {
  /** The maps the job makes before generating. */
  mapKeys: readonly string[];
  /** Its maps event arrived. */
  mapsArrived: boolean;
}

/** Skip acts on the job: it makes no maps, or they are made. */
export function skipApplies(job: SkipFacts): boolean {
  return job.mapKeys.length === 0 || job.mapsArrived;
}
