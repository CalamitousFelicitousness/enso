import type { JobDomain, StoredJobSnapshot } from "@/stores/jobStore";
import type { JobRequest } from "@/api/types/v2";
import { createIdbListDb } from "./idbListDb";

// Cap on retained IDB payloads. Each is ~1-5 KB (request shape + snapshot
// stripped of large blobs), so 200 ~ 1 MB ceiling. Beyond that the oldest
// records are evicted on the next write.
const MAX_PAYLOADS = 200;

export interface StoredJobPayload {
  id: string;
  domain: JobDomain;
  request: JobRequest;
  priority: number;
  snapshot: StoredJobSnapshot;
  createdAt: number;
}

const db = createIdbListDb<StoredJobPayload>({
  dbName: "SDNextJobPayloads",
  storeName: "payloads",
  sortKey: "createdAt",
});

export const getAllJobPayloads = (): Promise<StoredJobPayload[]> => db.getAll();
export const getJobPayload = (id: string): Promise<StoredJobPayload | undefined> => db.get(id);
export const trimJobPayloads = (maxCount: number): Promise<void> => db.trim(maxCount);
export const deleteJobPayload = (id: string): Promise<void> => db.delete(id);
export const clearAllJobPayloads = (): Promise<void> => db.clear();

export async function putJobPayload(payload: StoredJobPayload): Promise<void> {
  await db.put(payload);
  await db.trim(MAX_PAYLOADS);
}
