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
function harness() {
  const read: string[] = [];
  let time = 0;
  const timers: { at: number; run: () => void }[] = [];
  const live = createLiveQueries(
    {
      invalidateQueries: (filters?: { queryKey?: readonly unknown[] }) => {
        read.push(JSON.stringify(filters?.queryKey));
        return Promise.resolve();
      },
    } as never,
    () => time,
    (run, ms) => timers.push({ at: time + ms, run }),
  );
  const advance = (ms: number) => {
    time += ms;
    for (const timer of timers.filter((t) => t.at <= time)) {
      timers.splice(timers.indexOf(timer), 1);
      timer.run();
    }
  };
  return { live, read, advance };
}

const key = (...parts: string[]) => JSON.stringify(parts);

describe("the server's change events", () => {
  it("read again the records an event names, or every record when it names none", () => {
    const { live, read } = harness();
    live.event({ type: "records", data: { ids: ["j1", "j2"] } });
    live.event({ type: "records", data: { ids: null } });
    expect(read).toEqual([key("record", "j1"), key("record", "j2"), key("record")]);
  });

  it("read a key at most once a window, and once more when a burst ends", () => {
    const { live, read, advance } = harness();
    for (let i = 0; i < 10; i++) live.event({ type: "records", data: { ids: ["j1"] } });
    expect(read).toEqual([key("record", "j1")]);
    advance(THROTTLE_MS);
    expect(read).toEqual([key("record", "j1"), key("record", "j1")]);
    // a stream keeps reading, once a window
    advance(THROTTLE_MS);
    live.event({ type: "records", data: { ids: ["j1"] } });
    expect(read).toHaveLength(3);
  });

  it("read the records again once a pass or a verify has ended, not while a verify runs", () => {
    const { live, read } = harness();
    live.event({ type: "media", data: { verify: { running: true, checked: 1, total: 9 } } });
    expect(read).toEqual([]);
    live.event({ type: "media", data: { verify: { running: false, checked: 9, total: 9 } } });
    expect(read).toEqual([key("record")]);
  });

  it("read every live key on each open of the socket", () => {
    const { live, read } = harness();
    live.opened();
    live.opened();
    expect(read).toEqual([...LIVE_KEYS, ...LIVE_KEYS].map((k) => JSON.stringify(k)));
  });

  it("tells the media store's topics from the socket's other frames", () => {
    for (const type of ["records", "media", "library", "trash", "settings"]) {
      expect(isGlobalEvent({ type })).toBe(true);
    }
    for (const type of ["model", "progress", "download", undefined]) {
      expect(isGlobalEvent({ type })).toBe(false);
    }
  });
});
