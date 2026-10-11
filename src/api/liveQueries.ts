// What the server's change events do to the queries that show its data: one
// table from each topic to the keys it touches. A burst of events reads a key
// at most once per THROTTLE_MS, and the keys only events keep current are
// read again on every socket open, since a socket owes nothing from before it
// connected.

import type { QueryClient } from "@tanstack/react-query";
import { LIBRARY_KEY, recordKey, RECORDS_KEY, REPORT_KEY, SETTINGS_KEY } from "./queryKeys";
import type { ResMediaReportV2, ResMediaSettingsV2 } from "./types/media";

export const THROTTLE_MS = 500;

/** The queries whose data only events keep current. */
export const LIVE_KEYS: readonly (readonly string[])[] = [
  RECORDS_KEY,
  LIBRARY_KEY,
  REPORT_KEY,
  SETTINGS_KEY,
];

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

type Verify = NonNullable<ResMediaReportV2["verify"]>;

function verifyOf(data: unknown): Verify | null {
  const verify = (data as { verify?: Verify } | undefined)?.verify;
  return verify && typeof verify === "object" ? verify : null;
}

type SettingValues = Pick<
  ResMediaSettingsV2,
  "trash_days" | "library_cap" | "record_cap" | "reserve_bytes"
>;

export interface LiveQueries {
  event(msg: GlobalEvent): void;
  /** The socket opened: every live key is read again. */
  opened(): void;
}

export function createLiveQueries(
  client: Pick<QueryClient, "invalidateQueries" | "setQueryData">,
  options: {
    now?: () => number;
    schedule?: (run: () => void, ms: number) => unknown;
  } = {},
): LiveQueries {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? setTimeout;
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
        case "library":
        case "trash":
          invalidate(LIBRARY_KEY);
          break;
        case "settings": {
          const values = msg.data as SettingValues | undefined;
          if (!values) break;
          client.setQueryData<ResMediaSettingsV2>(SETTINGS_KEY, (old) =>
            old ? { ...old, ...values } : old,
          );
          break;
        }
        case "media": {
          const verify = verifyOf(msg.data);
          if (verify) {
            client.setQueryData<ResMediaReportV2>(REPORT_KEY, (old) =>
              old ? { ...old, verify } : old,
            );
          }
          // a pass or a verify can find blobs lost or back, which records and cards count
          if (!verify?.running) {
            invalidate(REPORT_KEY);
            invalidate(RECORDS_KEY);
            invalidate(LIBRARY_KEY);
          }
          break;
        }
      }
    },
    opened() {
      for (const key of LIVE_KEYS) read(key);
    },
  };
}
