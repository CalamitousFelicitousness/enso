import { describe, expect, it } from "vitest";
import { createGestures } from "./gesture";

/** An event as the tracker sees it: being dispatched until `done`. */
const event = () => {
  const e = { eventPhase: 2, done: () => void (e.eventPhase = 0) };
  return e;
};

function tracker() {
  const posted: (() => void)[] = [];
  const calls: string[] = [];
  const gestures = createGestures((fn) => posted.push(fn));
  gestures.listen({ start: () => calls.push("start"), end: () => calls.push("end") });
  return { gestures, calls, posted };
}

describe("gestures", () => {
  it("is open while its event is dispatched, and runs until it is ended", () => {
    const { gestures, calls, posted } = tracker();
    const key = event();
    gestures.starts(key);
    expect(gestures.open()).toBe(true);
    key.done();
    // the task is over; the gesture ends when the posted task runs
    expect(gestures.open()).toBe(false);
    expect(calls).toEqual(["start"]);
    posted[0]();
    expect(calls).toEqual(["start", "end"]);
  });

  it("stays open through an event dispatched inside its own", () => {
    const { gestures, calls } = tracker();
    const click = event();
    const blur = event();
    gestures.starts(click);
    gestures.continues(blur);
    blur.done();
    expect(gestures.open()).toBe(true);
    click.done();
    expect(gestures.open()).toBe(false);
    expect(calls).toEqual(["start"]);
  });

  it("keeps a start dispatched inside another event in that event's gesture", () => {
    const { gestures, calls } = tracker();
    const key = event();
    gestures.starts(key);
    gestures.starts(event());
    expect(calls).toEqual(["start"]);
  });

  it("ends the gesture before the next start, and continues it across one task's events", () => {
    const { gestures, calls } = tracker();
    const up = event();
    gestures.starts(up);
    up.done();
    const click = event();
    gestures.continues(click);
    expect(gestures.open()).toBe(true);
    expect(calls).toEqual(["start"]);
    click.done();
    gestures.starts(event());
    expect(calls).toEqual(["start", "end", "start"]);
  });

  it("begins a gesture from a continuing event when none runs", () => {
    const { gestures, calls } = tracker();
    gestures.continues(event());
    expect(calls).toEqual(["start"]);
    expect(gestures.open()).toBe(true);
  });

  it("leaves a gesture ended early closed for the event it ended in", () => {
    const { gestures, calls } = tracker();
    const key = event();
    gestures.starts(key);
    gestures.end();
    expect(gestures.open()).toBe(false);
    expect(gestures.adopt(key)).toBe(false);
    expect(calls).toEqual(["start", "end"]);
    // an event dispatched after it is a new action
    expect(gestures.adopt(event())).toBe(true);
    expect(calls).toEqual(["start", "end", "start"]);
  });

  it("adopts an unreported event into the running gesture once", () => {
    const { gestures, calls } = tracker();
    const up = event();
    gestures.starts(up);
    up.done();
    const mouseup = event();
    expect(gestures.adopt(mouseup)).toBe(true);
    expect(gestures.adopt(mouseup)).toBe(true);
    expect(gestures.open()).toBe(true);
    expect(calls).toEqual(["start"]);
  });

  it("lets a posted end close only the gesture that posted it", () => {
    const { gestures, calls, posted } = tracker();
    const first = event();
    gestures.starts(first);
    first.done();
    gestures.starts(event());
    posted[0]();
    expect(calls).toEqual(["start", "end", "start"]);
    expect(gestures.open()).toBe(true);
  });

  it("shows its text tag to the end listeners, then forgets it", () => {
    const gestures = createGestures(() => {});
    const tag = {};
    let seen: object | null = null;
    gestures.listen({ start: () => {}, end: () => (seen = gestures.tag()) });
    gestures.starts(event());
    gestures.typed(tag);
    gestures.end();
    expect(seen).toBe(tag);
    expect(gestures.tag()).toBeNull();
  });
});
