// The server's job records over HTTP. A card asks for one job's record and
// every id asked within a tick goes in one request, so a list of cards costs
// one read.

import { ApiError, api } from "./client";
import type { ItemRecordV2, ResRecordV2, ResRecordsV2 } from "./types/media";

/** The most ids one read may name. */
const CHUNK = 200;

interface Waiter {
  resolve: (item: ItemRecordV2 | null) => void;
  reject: (err: unknown) => void;
}

let waiting = new Map<string, Waiter[]>();
let scheduled = false;

/** `ids` repeated, as the server reads a list in a query. */
function idsQuery(ids: readonly string[]): string {
  return ids.map((id) => `ids=${encodeURIComponent(id)}`).join("&");
}

async function readChunk(ids: readonly string[]): Promise<Map<string, ItemRecordV2>> {
  const answer = await api.get<ResRecordsV2>(`/sdapi/v2/records?${idsQuery(ids)}`);
  return new Map(answer.records.map((item) => [item.job_id, item]));
}

function flush(): void {
  const asked = waiting;
  waiting = new Map();
  scheduled = false;
  const ids = [...asked.keys()];
  for (let start = 0; start < ids.length; start += CHUNK) {
    const chunk = ids.slice(start, start + CHUNK);
    readChunk(chunk).then(
      (items) => {
        for (const id of chunk)
          for (const w of asked.get(id) ?? []) w.resolve(items.get(id) ?? null);
      },
      (err: unknown) => {
        for (const id of chunk) for (const w of asked.get(id) ?? []) w.reject(err);
      },
    );
  }
}

/** One job's record as a list shows it; null when the server keeps none. */
export function recordItem(id: string): Promise<ItemRecordV2 | null> {
  return new Promise((resolve, reject) => {
    const list = waiting.get(id) ?? [];
    list.push({ resolve, reject });
    waiting.set(id, list);
    if (!scheduled) {
      scheduled = true;
      setTimeout(flush, 0);
    }
  });
}

/** The records a browser sent, newest first; `routed` false for those whose
 * results have not reached it yet. */
export async function clientRecords(client: string, routed?: boolean): Promise<ItemRecordV2[]> {
  const params: Record<string, string> = { client };
  if (routed !== undefined) params["routed"] = String(routed);
  return (await api.get<ResRecordsV2>("/sdapi/v2/records", params)).records;
}

/** A job's whole record; null when the server keeps none. */
export async function readRecord(id: string): Promise<ResRecordV2 | null> {
  try {
    return await api.get<ResRecordV2>(`/sdapi/v2/records/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** The job's result reached a strip, or never will; false when the server keeps no record. */
export async function routeRecord(id: string): Promise<boolean> {
  try {
    await api.patch<ItemRecordV2>(`/sdapi/v2/records/${encodeURIComponent(id)}`, { routed: true });
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return false;
    throw err;
  }
}
