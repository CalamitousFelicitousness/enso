// The job lists cost 5 of sdnext's 300 reads a minute per client, a budget POST /jobs
// shares. The events of one job (its submit, its end, the server going idle) read each
// list once, after they settle, and a steady stream of them reads it every MAX_WAIT_MS.

import type { QueryClient } from "@tanstack/react-query";
import { queryClient } from "./queryClient";

/** Every job list, History's among them. */
export const JOB_LISTS_KEY = ["v2-jobs", "list"] as const;
/** The Bottom Bar's count of completed generate jobs. */
export const GENERATIONS_KEY = ["v2-jobs", "generations"] as const;

export const SETTLE_MS = 500;
export const MAX_WAIT_MS = 5000;

export interface JobListRefresh {
  /** A job was sent or ended, or the server went idle. */
  lists(): void;
  /** A generate job this page sent completed. */
  generations(): void;
}

export function createJobListRefresh(
  client: Pick<QueryClient, "invalidateQueries">,
  options: {
    now?: () => number;
    schedule?: (run: () => void, ms: number) => unknown;
    cancel?: (handle: unknown) => void;
  } = {},
): JobListRefresh {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? setTimeout;
  const cancel =
    options.cancel ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const waiting = new Map<string, { since: number; handle: unknown }>();
  const request = (key: readonly unknown[]) => {
    const id = JSON.stringify(key);
    const at = now();
    const pending = waiting.get(id);
    if (pending) cancel(pending.handle);
    const since = pending?.since ?? at;
    const handle = schedule(
      () => {
        waiting.delete(id);
        void client.invalidateQueries({ queryKey: key });
      },
      Math.min(SETTLE_MS, since + MAX_WAIT_MS - at),
    );
    waiting.set(id, { since, handle });
  };
  return {
    lists: () => request(JOB_LISTS_KEY),
    generations: () => request(GENERATIONS_KEY),
  };
}

/** The page's one refresh, for code outside React as well as inside. */
export const jobLists = createJobListRefresh(queryClient);
