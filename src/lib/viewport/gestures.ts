import { pinchStep, type PinchStep, type PointerPair } from "./pinch";
import type { Point, Size } from "./types";
import { normalizeWheel, wheelIntent, type WheelInput, type WheelMode } from "./wheel";

export type PointerKind = "mouse" | "pen" | "touch";
/** Where a pointer or wheel event landed: the drawn canvas, or chrome over it
 * (docks, buttons, the player). */
export type TargetClass = "content" | "chrome";
/** What the drawn canvas holds under a pointer: a node Konva drags, a click
 * target that opens the file picker, any other shape, or nothing. */
export type HitClass = "draggable" | "picker" | "shape" | "none";
/** Where keyboard focus is when Space goes down: the page or the canvas, a
 * control over the canvas, or anywhere else (a text field included). */
export type FocusClass = "canvas" | "chrome" | "other";
/** `other`: a tool that owns the left button (the mask brush). */
export type SurfaceTool = "move" | "other";

export interface GestureEnv {
  tool: SurfaceTool;
  wheelMode: WheelMode;
  /** False while the mode lock holds the camera still. */
  allowed: boolean;
}

export type GestureInput =
  | {
      type: "down";
      pointerId: number;
      kind: PointerKind;
      button: number;
      point: Point;
      target: TargetClass;
      hit: HitClass;
    }
  | { type: "move"; pointerId: number; kind: PointerKind; point: Point }
  /** A release; `cancel` covers pointercancel and a lost capture. */
  | { type: "up" | "cancel"; pointerId: number; kind: PointerKind }
  | {
      type: "wheel";
      time: number;
      wheel: WheelInput;
      defaultPrevented: boolean;
      target: TargetClass;
      point: Point;
      container: Size;
    }
  | { type: "spaceDown"; focus: FocusClass }
  | { type: "spaceUp" }
  | { type: "blur" };

export type GestureEffect =
  /** Capture the pointer on the surface, so the release lands there. */
  | { type: "capture"; pointerId: number }
  | { type: "release"; pointerId: number }
  | { type: "pan"; dx: number; dy: number }
  | { type: "zoom"; point: Point; factor: number }
  | { type: "pinch"; step: PinchStep }
  /** A gesture or a wheel sequence began. */
  | { type: "start" }
  | { type: "commit" }
  /** Commit once the wheel has been quiet for `WHEEL_SETTLE_MS`. */
  | { type: "settle" }
  /** preventDefault on the event that came in. */
  | { type: "prevent" }
  /** preventDefault on the mousedown that follows this pointerdown: no
   * autoscroll, no primary-selection paste, no text selection. */
  | { type: "preventMouseDown" }
  /** Stop Konva's drags and transforms with nothing saved, and drop an
   * unfinished mask stroke. */
  | { type: "interrupt" }
  /** No click or tap follows the release. */
  | { type: "clearClick" }
  /** Konva sees no touch event until every finger lifts. */
  | { type: "withholdTouch" };

interface TouchPoint {
  id: number;
  point: Point;
}

export type Drag =
  | { kind: "idle" }
  /** A left press on empty canvas that pans once it moves past the slop. */
  | { kind: "pending"; pointerId: number; pointer: PointerKind; start: Point }
  | { kind: "pan"; pointerId: number; pointer: PointerKind; last: Point }
  | { kind: "pinch"; ids: readonly [number, number] }
  /** A pinch ended: the fingers left start nothing until every one lifts. */
  | { kind: "spent" };

export interface GestureState {
  drag: Drag;
  /** Every touch pointer down on the surface. */
  touches: readonly TouchPoint[];
  /** `armed`: Space pans; `blocked`: Space went down on a control over the
   * canvas and does nothing. */
  space: "up" | "armed" | "blocked";
  /** When the last wheel event moved the camera. */
  wheelAt: number;
}

export const IDLE_GESTURES: GestureState = {
  drag: { kind: "idle" },
  touches: [],
  space: "up",
  wheelAt: Number.NEGATIVE_INFINITY,
};

/** A wheel sequence ends, and its camera commits, after this much quiet. */
export const WHEEL_SETTLE_MS = 150;
const SLOP_PX: Record<PointerKind, number> = { mouse: 4, pen: 4, touch: 10 };
const LEFT = 0;
const MIDDLE = 1;

export interface GestureStep {
  state: GestureState;
  effects: GestureEffect[];
}

function same(state: GestureState): GestureStep {
  return { state, effects: [] };
}

function pairOf(
  touches: readonly TouchPoint[],
  ids: readonly [number, number],
): PointerPair | null {
  const a = touches.find((t) => t.id === ids[0]);
  const b = touches.find((t) => t.id === ids[1]);
  return a && b ? [a.point, b.point] : null;
}

/** The pan that starts on a press or after the slop. */
function armPan(pointerId: number, kind: PointerKind): GestureEffect[] {
  const effects: GestureEffect[] = [
    { type: "capture", pointerId },
    { type: "clearClick" },
    { type: "start" },
  ];
  if (kind === "touch") effects.push({ type: "withholdTouch" });
  return effects;
}

function down(
  state: GestureState,
  input: Extract<GestureInput, { type: "down" }>,
  env: GestureEnv,
): GestureStep {
  const { pointerId, kind, button, point, target, hit } = input;
  let touches = state.touches;
  if (kind === "touch")
    touches = [...touches.filter((t) => t.id !== pointerId), { id: pointerId, point }];
  const next = { ...state, touches };
  const { drag } = state;

  if (kind === "touch" && touches.length >= 2) {
    if (drag.kind === "pinch" || drag.kind === "spent") return same(next);
    const busyElsewhere =
      (drag.kind === "pan" || drag.kind === "pending") && drag.pointer !== "touch";
    if (busyElsewhere || !env.allowed) return same(next);
    const first = touches.find((t) => t.id !== pointerId);
    if (!first) return same(next);
    return {
      state: { ...next, drag: { kind: "pinch", ids: [first.id, pointerId] } },
      effects: [
        { type: "interrupt" },
        { type: "clearClick" },
        { type: "withholdTouch" },
        { type: "start" },
      ],
    };
  }

  if (drag.kind !== "idle" || target !== "content") return same(next);
  if (!env.allowed) {
    return button === MIDDLE && kind !== "touch"
      ? { state: next, effects: [{ type: "preventMouseDown" }] }
      : same(next);
  }
  const middle = button === MIDDLE && kind !== "touch";
  const spacePan = button === LEFT && state.space === "armed";
  if (middle || spacePan) {
    return {
      state: { ...next, drag: { kind: "pan", pointerId, pointer: kind, last: point } },
      effects: [{ type: "preventMouseDown" }, ...armPan(pointerId, kind)],
    };
  }
  if (button === LEFT && env.tool === "move" && hit !== "draggable") {
    return same({ ...next, drag: { kind: "pending", pointerId, pointer: kind, start: point } });
  }
  return same(next);
}

function move(state: GestureState, input: Extract<GestureInput, { type: "move" }>): GestureStep {
  const { pointerId, kind, point } = input;
  const touches =
    kind === "touch"
      ? state.touches.map((t) => (t.id === pointerId ? { id: pointerId, point } : t))
      : state.touches;
  const next = { ...state, touches };
  const { drag } = state;

  if (drag.kind === "pending" && drag.pointerId === pointerId) {
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    if (Math.hypot(dx, dy) < SLOP_PX[drag.pointer]) return same(next);
    // From the press, so the canvas stays under the pointer
    return {
      state: { ...next, drag: { kind: "pan", pointerId, pointer: drag.pointer, last: point } },
      effects: [...armPan(pointerId, drag.pointer), { type: "pan", dx, dy }],
    };
  }
  if (drag.kind === "pan" && drag.pointerId === pointerId) {
    const dx = point.x - drag.last.x;
    const dy = point.y - drag.last.y;
    const moved: GestureState = { ...next, drag: { ...drag, last: point } };
    return dx === 0 && dy === 0
      ? same(moved)
      : { state: moved, effects: [{ type: "pan", dx, dy }] };
  }
  if (drag.kind === "pinch" && drag.ids.includes(pointerId)) {
    const prev = pairOf(state.touches, drag.ids);
    const curr = pairOf(touches, drag.ids);
    if (!prev || !curr) return same(next);
    return { state: next, effects: [{ type: "pinch", step: pinchStep(prev, curr) }] };
  }
  return same(next);
}

function up(
  state: GestureState,
  input: Extract<GestureInput, { type: "up" | "cancel" }>,
): GestureStep {
  const { pointerId, kind } = input;
  const touches =
    kind === "touch" ? state.touches.filter((t) => t.id !== pointerId) : state.touches;
  const next = { ...state, touches };
  const { drag } = state;
  const idle: Drag = { kind: "idle" };

  if (drag.kind === "pending" && drag.pointerId === pointerId) return same({ ...next, drag: idle });
  if (drag.kind === "pan" && drag.pointerId === pointerId) {
    return { state: { ...next, drag: idle }, effects: [{ type: "commit" }] };
  }
  if (drag.kind === "pinch" && drag.ids.includes(pointerId)) {
    const after: Drag = touches.length > 0 ? { kind: "spent" } : idle;
    return { state: { ...next, drag: after }, effects: [{ type: "commit" }] };
  }
  if (drag.kind === "spent" && touches.length === 0) return same({ ...next, drag: idle });
  return same(next);
}

function wheel(
  state: GestureState,
  input: Extract<GestureInput, { type: "wheel" }>,
  env: GestureEnv,
): GestureStep {
  if (input.defaultPrevented) return same(state);
  const normalized = normalizeWheel(input.wheel, input.container);
  // A plain wheel over a dock or a control scrolls or steps it
  if (input.target !== "content" && !normalized.pinch) return same(state);
  const prevent: GestureEffect = { type: "prevent" };
  if (!env.allowed) return { state, effects: [prevent] };
  const intent = wheelIntent(normalized, env.wheelMode);
  if (!intent) return { state, effects: [prevent] };
  const effects: GestureEffect[] = [prevent];
  if (input.time - state.wheelAt >= WHEEL_SETTLE_MS) effects.push({ type: "start" });
  effects.push(
    intent.kind === "pan"
      ? { type: "pan", dx: intent.dx, dy: intent.dy }
      : { type: "zoom", point: input.point, factor: intent.factor },
    { type: "settle" },
  );
  return { state: { ...state, wheelAt: input.time }, effects };
}

function spaceDown(state: GestureState, focus: FocusClass): GestureStep {
  if (focus === "other") return same(state);
  const prevent: GestureEffect = { type: "prevent" };
  if (state.space !== "up") return { state, effects: [prevent] };
  return {
    state: { ...state, space: focus === "canvas" ? "armed" : "blocked" },
    effects: [prevent],
  };
}

function blur(state: GestureState): GestureStep {
  const { drag } = state;
  const effects: GestureEffect[] = [];
  if (drag.kind === "pan") {
    if (drag.pointer !== "touch") effects.push({ type: "release", pointerId: drag.pointerId });
    effects.push({ type: "commit" });
  } else if (drag.kind === "pinch") {
    effects.push({ type: "commit" });
  }
  return { state: { ...IDLE_GESTURES, wheelAt: state.wheelAt }, effects };
}

/**
 * The canvas's pointer, wheel and Space handling as a pure step: what each
 * event starts, moves or ends, and what the surface must do about it.
 */
export function gestureStep(
  state: GestureState,
  input: GestureInput,
  env: GestureEnv,
): GestureStep {
  switch (input.type) {
    case "down":
      return down(state, input, env);
    case "move":
      return move(state, input);
    case "up":
    case "cancel":
      return up(state, input);
    case "wheel":
      return wheel(state, input, env);
    case "spaceDown":
      return spaceDown(state, input.focus);
    case "spaceUp": {
      const effects: GestureEffect[] = state.space === "blocked" ? [{ type: "prevent" }] : [];
      return { state: { ...state, space: "up" }, effects };
    }
    case "blur":
      return blur(state);
  }
}

/**
 * The cursor over the drawn canvas; null leaves it to the tool that owns it
 * (the mask brush hides it).
 */
export function surfaceCursor(
  state: GestureState,
  env: GestureEnv,
  hover: HitClass | null,
): string | null {
  const { drag } = state;
  if (drag.kind === "pan" || drag.kind === "pinch") return "grabbing";
  if (state.space === "armed") return "grab";
  if (env.tool !== "move" || hover === null) return null;
  if (hover === "picker") return "pointer";
  if (hover === "draggable" || !env.allowed) return "";
  return "grab";
}
