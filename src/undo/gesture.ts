// The gesture source: the dispatch of one user input event. A recorded write
// made by a listener, or by a microtask a listener queued (React renders a
// discrete event's update and flushes its effects there), belongs to the
// user's action. An event is being dispatched exactly while its eventPhase is
// not NONE, which also holds through synthetic events its listeners dispatch.

export interface GestureListener {
  readonly start: () => void;
  readonly end: () => void;
}

export interface Gestures {
  /** A user input event of the current gesture is being dispatched. False
   * once its task is over, even before the gesture has ended. */
  readonly open: () => boolean;
  /** The text field the gesture's input event typed into, one object per
   * focus session; null when it typed into none. */
  readonly tag: () => object | null;
  /** Nothing more in this task is the user's action. */
  readonly end: () => void;
  readonly listen: (listener: GestureListener) => () => void;
}

/** What the tracker needs of an event: NONE (0) once its dispatch is over. */
export interface Dispatched {
  readonly eventPhase: number;
}

export interface GestureTracker extends Gestures {
  /** An event that begins a user action in a task of its own. */
  readonly starts: (event: Dispatched) => void;
  /** An event that follows a start in its task, or begins an action alone. */
  readonly continues: (event: Dispatched) => void;
  /** An event found being dispatched that no listener reported; false when
   * the gesture it belongs to was ended early. */
  readonly adopt: (event: Dispatched) => boolean;
  readonly typed: (tag: object) => void;
}

/**
 * Gestures over reported events. A gesture runs from its first event until
 * `end`, which `post` calls in a later task so a step closes soon after its
 * task; `open` is exact meanwhile.
 */
export function createGestures(post: (fn: () => void) => void): GestureTracker {
  const listeners = new Set<GestureListener>();
  let counter = 0;
  /** The running gesture's number; 0 between gestures. */
  let session = 0;
  /** The gesture's events still being dispatched, outermost first. */
  let live: Dispatched[] = [];
  /** Events live when their gesture was ended early: not adopted again. */
  let over: readonly Dispatched[] = [];
  let tag: object | null = null;

  const prune = () => {
    live = live.filter((e) => e.eventPhase !== 0);
  };
  // listeners run before the tag clears, so a closing step still sees it
  const end = () => {
    if (session === 0) return;
    for (const listener of listeners) listener.end();
    prune();
    over = live;
    live = [];
    session = 0;
    tag = null;
  };
  const begin = () => {
    end();
    const id = ++counter;
    session = id;
    for (const listener of listeners) listener.start();
    post(() => {
      if (session === id) end();
    });
  };
  const continues = (event: Dispatched) => {
    if (session === 0) begin();
    prune();
    live.push(event);
  };

  return {
    open: () => {
      prune();
      return live.length > 0;
    },
    tag: () => tag,
    end,
    listen: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    starts: (event) => {
      prune();
      // dispatched inside another event's listener: part of that action
      if (live.length === 0) begin();
      live.push(event);
    },
    continues,
    adopt: (event) => {
      if (over.includes(event) || live.includes(event)) return live.includes(event);
      continues(event);
      return true;
    },
    typed: (next) => {
      tag = next;
    },
  };
}

/** Events that begin a user action in a task of their own. */
const STARTS = ["pointerdown", "pointerup", "pointercancel", "keydown", "keyup", "wheel"] as const;

/** Events dispatched after a start in its task (mouseup and click after
 * pointerup, input after keydown, focusout as focus moves), or that begin an
 * action when none is running (a paste from the menu, a dropped file, a field
 * losing focus to another window). */
const CONTINUES = [
  "mousedown",
  "mouseup",
  "touchstart",
  "touchend",
  "touchcancel",
  "click",
  "auxclick",
  "dblclick",
  "contextmenu",
  "keypress",
  "beforeinput",
  "input",
  "change",
  "compositionend",
  "focusout",
  "dragend",
  "drop",
  "paste",
  "cut",
] as const;

const TEXT_TYPES = new Set(["text", "search", "url", "email", "tel", "password"]);

function isTextField(target: EventTarget | null): target is HTMLElement {
  if (target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && TEXT_TYPES.has(target.type);
}

interface Scheduler {
  postTask?: (callback: () => void, options: { priority: string }) => Promise<unknown>;
}

/** Run `fn` in a task after this one, ahead of timers and network callbacks
 * where the browser can. */
function nextTask(): (fn: () => void) => void {
  const scheduler = (globalThis as { scheduler?: Scheduler }).scheduler;
  if (scheduler?.postTask) {
    const post = scheduler.postTask.bind(scheduler);
    return (fn) => void post(fn, { priority: "user-blocking" });
  }
  const channel = new MessageChannel();
  const queue: (() => void)[] = [];
  channel.port1.onmessage = () => queue.shift()?.();
  return (fn) => {
    queue.push(fn);
    channel.port2.postMessage(null);
  };
}

/** Gestures from the window's trusted input events. */
export function windowGestures(win: Window = window): Gestures & { readonly stop: () => void } {
  const tracker = createGestures(nextTask());
  const sessions = new WeakMap<EventTarget, object>();

  const onStart = (e: Event) => {
    if (e.isTrusted) tracker.starts(e);
  };
  const onContinue = (e: Event) => {
    if (!e.isTrusted) return;
    tracker.continues(e);
    if (e.type !== "input" || !isTextField(e.target)) return;
    let session = sessions.get(e.target);
    if (!session) {
      session = {};
      sessions.set(e.target, session);
    }
    tracker.typed(session);
  };
  // a new focus session: typing after it is a new run
  const onFocus = (e: Event) => {
    if (isTextField(e.target)) sessions.set(e.target, {});
  };
  /** A trusted UI event of a type not listened for, or one whose listeners
   * here ran after an earlier window listener wrote: the window's current
   * event names it unless a synthetic event is nested in it right now. */
  const current = () => {
    const e = win.event;
    return e?.isTrusted && e instanceof UIEvent && e.eventPhase !== 0 ? tracker.adopt(e) : false;
  };

  const options = { capture: true, passive: true } as const;
  for (const type of STARTS) win.addEventListener(type, onStart, options);
  for (const type of CONTINUES) win.addEventListener(type, onContinue, options);
  win.addEventListener("focusin", onFocus, options);

  return {
    open: () => tracker.open() || current(),
    tag: tracker.tag,
    end: tracker.end,
    listen: tracker.listen,
    stop: () => {
      tracker.end();
      for (const type of STARTS) win.removeEventListener(type, onStart, options);
      for (const type of CONTINUES) win.removeEventListener(type, onContinue, options);
      win.removeEventListener("focusin", onFocus, options);
    },
  };
}

/** Gestures driven by hand, for tests: `start` dispatches an input event,
 * `leave` ends its task without ending the gesture, `end` ends the gesture. */
export function drivenGestures(): Gestures & {
  readonly start: (tag?: object | null) => void;
  readonly leave: () => void;
} {
  const tracker = createGestures(() => {});
  let event = { eventPhase: 0 };
  return {
    open: tracker.open,
    tag: tracker.tag,
    end: () => {
      tracker.end();
      event.eventPhase = 0;
    },
    listen: tracker.listen,
    start: (tag = null) => {
      event.eventPhase = 0;
      event = { eventPhase: 2 };
      tracker.starts(event);
      if (tag) tracker.typed(tag);
    },
    leave: () => {
      event.eventPhase = 0;
    },
  };
}
