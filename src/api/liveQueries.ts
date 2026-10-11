// What the server's change events do to the queries that show its data: one
// table from each topic to the keys it touches. A burst of events reads a key
// at most once per THROTTLE_MS, and the keys only events keep current are
// read again on every socket open, since a socket owes nothing from before it
// connected.

import type { QueryClient } from "@tanstack/react-query";
import { recordKey, RECORDS_KEY } from "./queryKeys";

export const THROTTLE_MS = 500;

/** The queries whose data only events keep current. */
export const LIVE_KEYS: readonly (readonly string[])[] = [RECORDS_KEY];

const TOPICS = ["records", "media", "library", "trash", "settings"] as const;
type Topic = (typeof TOPICS)[number];

export interface GlobalEvent {
  type: Topic;
  data?: unknown;
}

/** A global socket frame that carries one of the media store's topics. */
export function isGlobalEvent(msg: { type?: unknown }): msg is GlobalEvent {
  return TOPICS.some((topic) => topic === msg.type);
}

/** The ids a change event names; null when the socket fell behind and every
 * row may have changed. */
function idsOf(data: unknown): string[] | null {
  const ids = (data as { ids?: unknown } | undefined)?.ids;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : null;
}

function verifyRunning(data: unknown): boolean {
  return (data as { verify?: { running?: unknown } } | undefined)?.verify?.running === true;
}

export interface LiveQueries {
  event(msg: GlobalEvent): void;
  /** The socket opened: every live key is read again. */
  opened(): void;
}

export function createLiveQueries(
  client: Pick<QueryClient, "invalidateQueries">,
  now: () => number = Date.now,
  schedule: (run: () => void, ms: number) => unknown = setTimeout,
): LiveQueries {
  const last = new Map<string, number>();
  const queued = new Set<string>();
  const read = (key: readonly unknown[]) => {
    last.set(JSON.stringify(key), now());
    void client.invalidateQueries({ queryKey: key });
  };
  // the first change reads at once; the rest of a burst once at the window's end
  const invalidate = (key: readonly unknown[]) => {
    const id = JSON.stringify(key);
    const since = now() - (last.get(id) ?? -Infinity);
    if (since >= THROTTLE_MS) {
      read(key);
      return;
    }
    if (queued.has(id)) return;
    queued.add(id);
    schedule(() => {
      queued.delete(id);
      read(key);
    }, THROTTLE_MS - since);
  };
  return {
    event(msg) {
      switch (msg.type) {
        case "records": {
          const ids = idsOf(msg.data);
          if (ids) ids.forEach((id) => invalidate(recordKey(id)));
          else invalidate(RECORDS_KEY);
          break;
        }
        case "media":
          // a pass or a verify can find blobs lost or back, which the records count
          if (!verifyRunning(msg.data)) invalidate(RECORDS_KEY);
          break;
        default:
          break;
      }
    },
    opened() {
      for (const key of LIVE_KEYS) read(key);
    },
  };
}
