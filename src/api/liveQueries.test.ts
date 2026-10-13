import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let createLiveQueries: typeof import("./liveQueries").createLiveQueries;
let isGlobalEvent: typeof import("./liveQueries").isGlobalEvent;
let LIVE_KEYS: typeof import("./liveQueries").LIVE_KEYS;
let THROTTLE_MS: number;

beforeEach(async () => {
  vi.resetModules();
  // the query keys share the API client's error type, whose module reads the page's origin
  vi.stubGlobal("window", { location: { origin: "http://localhost:5174" } });
  ({ createLiveQueries, isGlobalEvent, LIVE_KEYS, THROTTLE_MS } = await import("./liveQueries"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A query client that notes what it is asked to read again, a clock and a timer queue. */
/** A query client that notes what it reads again and the data events set. */
function harness() {
  const read: string[] = [];
  const data = new Map<string, unknown>();
  let time = 0;
  const timers: { at: number; run: () => void }[] = [];
  const live = createLiveQueries(
    {
      invalidateQueries: (filters?: { queryKey?: readonly unknown[]; refetchType?: string }) => {
        // a key only marked stale is read when next shown
        read.push(
          `${JSON.stringify(filters?.queryKey)}${filters?.refetchType === "none" ? " stale" : ""}`,
        );
        return Promise.resolve();
      },
      setQueryData: (key: readonly unknown[], update: (old: unknown) => unknown) => {
        const id = JSON.stringify(key);
        data.set(id, update(data.get(id)));
        return data.get(id);
      },
    } as never,
    {
      now: () => time,
      schedule: (run: () => void, ms: number) => timers.push({ at: time + ms, run }),
    },
  );
  const advance = (ms: number) => {
    time += ms;
    for (const timer of timers.filter((t) => t.at <= time)) {
      timers.splice(timers.indexOf(timer), 1);
      timer.run();
    }
  };
  return { live, read, advance, data };
}

const key = (...parts: string[]) => JSON.stringify(parts);

describe("the server's change events", () => {
  it("read again the records an event names, or every record when it names none", () => {
    const { live, read } = harness();
    live.event({ type: "records", data: { ids: ["j1", "j2"] } });
    live.event({ type: "records", data: { ids: null } });
    expect(read.filter((k) => k !== key("my-records"))).toEqual([
      key("record", "j1"),
      key("record", "j2"),
      key("record"),
    ]);
  });

  it("read this browser's record list again when any record changes, once a window", () => {
    const { live, read, advance } = harness();
    const mine = () => read.filter((k) => k === key("my-records"));
    live.event({ type: "records", data: { ids: ["j1"] } });
    live.event({ type: "records", data: { ids: null } });
    expect(mine()).toHaveLength(1);
    advance(THROTTLE_MS);
    expect(mine()).toHaveLength(2);
  });

  it("read a key at most once a window, and once more when a burst ends", () => {
    const { live, read, advance } = harness();
    const j1 = () => read.filter((k) => k === key("record", "j1"));
    for (let i = 0; i < 10; i++) live.event({ type: "records", data: { ids: ["j1"] } });
    expect(j1()).toHaveLength(1);
    advance(THROTTLE_MS);
    expect(j1()).toHaveLength(2);
    // a stream keeps reading, once a window
    advance(THROTTLE_MS);
    live.event({ type: "records", data: { ids: ["j1"] } });
    expect(j1()).toHaveLength(3);
  });

  it("show a verify's progress at once, and read the report, records and library when it ends", () => {
    const { live, read, data } = harness();
    data.set(key("media-report"), { enabled: true });
    live.event({ type: "media", data: { verify: { running: true, checked: 1, total: 9 } } });
    expect(read).toEqual([]);
    expect(data.get(key("media-report"))).toEqual({
      enabled: true,
      verify: { running: true, checked: 1, total: 9 },
    });
    live.event({ type: "media", data: { verify: { running: false, checked: 9, total: 9 } } });
    expect(read).toEqual([key("media-report"), key("record"), key("library")]);
  });

  it("read the library, its trash and entries again when either changes", () => {
    const { live, read, advance } = harness();
    live.event({ type: "library", data: { ids: ["e1"] } });
    live.event({ type: "trash", data: { ids: null } });
    expect(read).toEqual([key("library")]);
    advance(THROTTLE_MS);
    expect(read).toEqual([key("library"), key("library")]);
  });

  it("put changed settings over the ones held, keeping their bounds", () => {
    const { live, data, read } = harness();
    data.set(key("media-settings"), {
      trash_days: 7,
      library_cap: 100,
      bounds: { trash_days: {} },
    });
    live.event({
      type: "settings",
      data: { trash_days: 3, library_cap: 50, record_cap: 200, reserve_bytes: 1 },
    });
    expect(data.get(key("media-settings"))).toEqual({
      trash_days: 3,
      library_cap: 50,
      record_cap: 200,
      reserve_bytes: 1,
      bounds: { trash_days: {} },
    });
    // the expiries of trashed entries, the Gallery trash and trashed outputs move with the days
    expect(read).toEqual([key("library", "trash"), key("gallery-trash"), key("trashed-outputs")]);
  });

  it("read the Gallery trash, the trashed outputs and the report again, and mark the job lookups stale, when files enter or leave the trash", () => {
    const { live, read, advance } = harness();
    const stale = `${key("output-job")} stale`;
    live.event({ type: "outputs", data: { ids: ["t1"] } });
    live.event({ type: "outputs", data: { ids: ["t2"] } });
    expect(read).toEqual([
      key("gallery-trash"),
      key("trashed-outputs"),
      stale,
      key("media-report"),
      stale,
    ]);
    advance(THROTTLE_MS);
    expect(read).toEqual([
      key("gallery-trash"),
      key("trashed-outputs"),
      stale,
      key("media-report"),
      stale,
      key("gallery-trash"),
      key("trashed-outputs"),
      key("media-report"),
    ]);
  });

  it("read every live key on each open of the socket", () => {
    const { live, read } = harness();
    live.opened();
    live.opened();
    expect(read).toEqual([...LIVE_KEYS, ...LIVE_KEYS].map((k) => JSON.stringify(k)));
  });

  it("tells the media store's topics from the socket's other frames", () => {
    for (const type of ["records", "media", "library", "trash", "settings", "outputs"]) {
      expect(isGlobalEvent({ type })).toBe(true);
    }
    for (const type of ["model", "progress", "download", undefined]) {
      expect(isGlobalEvent({ type })).toBe(false);
    }
  });
});
