import { describe, expect, it } from "vitest";
import {
  createJobListRefresh,
  GENERATIONS_KEY,
  JOB_LISTS_KEY,
  MAX_WAIT_MS,
  SETTLE_MS,
} from "./jobLists";

/** A query client that notes what it reads again, a clock and a cancellable timer queue. */
function harness() {
  const read: string[] = [];
  let time = 0;
  let next = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const refresh = createJobListRefresh(
    {
      invalidateQueries: (filters?: { queryKey?: readonly unknown[] }) => {
        read.push(JSON.stringify(filters?.queryKey));
        return Promise.resolve();
      },
    } as never,
    {
      now: () => time,
      schedule: (run, ms) => {
        timers.set(next, { at: time + ms, run });
        return next++;
      },
      cancel: (handle) => timers.delete(handle as number),
    },
  );
  const advance = (ms: number) => {
    const end = time + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      time = due[1].at;
      due[1].run();
    }
    time = end;
  };
  return { refresh, read, advance };
}

const LISTS = JSON.stringify(JOB_LISTS_KEY);
const GENERATIONS = JSON.stringify(GENERATIONS_KEY);

describe("job list refresh", () => {
  it("reads the lists once for a job's end and the idle that follows it", () => {
    const { refresh, read, advance } = harness();
    refresh.lists();
    advance(100);
    refresh.lists();
    advance(SETTLE_MS - 1);
    expect(read).toEqual([]);
    advance(1);
    expect(read).toEqual([LISTS]);
  });

  it("reads a steady stream of events every MAX_WAIT_MS", () => {
    const { refresh, read, advance } = harness();
    for (let at = 0; at < 2 * MAX_WAIT_MS; at += 100) {
      refresh.lists();
      advance(100);
    }
    expect(read).toEqual([LISTS, LISTS]);
  });

  it("reads the count apart from the lists", () => {
    const { refresh, read, advance } = harness();
    refresh.generations();
    refresh.lists();
    advance(SETTLE_MS);
    expect([...read].sort()).toEqual([GENERATIONS, LISTS].sort());
  });
});
