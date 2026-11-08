import { describe, expect, it } from "vitest";
import {
  IDLE_GESTURES,
  WHEEL_SETTLE_MS,
  gestureStep,
  surfaceCursor,
  type GestureEffect,
  type GestureEnv,
  type GestureInput,
  type GestureState,
  type HitClass,
  type PointerKind,
  type TargetClass,
} from "./gestures";
import { ctrlZoomFactor, wheelZoomFactor, type WheelInput } from "./wheel";

const MOVE: GestureEnv = { tool: "move", wheelMode: "pan" };
const PAINT: GestureEnv = { ...MOVE, tool: "other" };
const container = { width: 800, height: 600 };

function down(
  pointerId: number,
  x: number,
  y: number,
  opts: { kind?: PointerKind; button?: number; target?: TargetClass; hit?: HitClass } = {},
): GestureInput {
  return {
    type: "down",
    pointerId,
    kind: opts.kind ?? "mouse",
    button: opts.button ?? 0,
    point: { x, y },
    target: opts.target ?? "content",
    hit: opts.hit ?? "none",
  };
}

function move(pointerId: number, x: number, y: number, kind: PointerKind = "mouse"): GestureInput {
  return { type: "move", pointerId, kind, point: { x, y } };
}

function up(pointerId: number, kind: PointerKind = "mouse"): GestureInput {
  return { type: "up", pointerId, kind };
}

function wheel(
  time: number,
  patch: Partial<WheelInput>,
  opts: { target?: TargetClass; defaultPrevented?: boolean } = {},
): GestureInput {
  return {
    type: "wheel",
    time,
    wheel: {
      deltaMode: 0,
      deltaX: 0,
      deltaY: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      ...patch,
    },
    defaultPrevented: opts.defaultPrevented ?? false,
    target: opts.target ?? "content",
    point: { x: 100, y: 50 },
    container,
  };
}

/** Runs inputs in order and gathers every effect. */
function run(inputs: GestureInput[], env: GestureEnv = MOVE, start: GestureState = IDLE_GESTURES) {
  let state = start;
  const effects: GestureEffect[] = [];
  for (const input of inputs) {
    const step = gestureStep(state, input, env);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
}

const types = (effects: GestureEffect[]) => effects.map((e) => e.type);
const pans = (effects: GestureEffect[]) =>
  effects.flatMap((e) => (e.type === "pan" ? [[e.dx, e.dy]] : []));

describe("wheel", () => {
  it("pans the canvas under the Pan setting", () => {
    const { effects } = run([wheel(1000, { deltaX: 5, deltaY: 40 })]);
    expect(types(effects)).toEqual(["prevent", "start", "pan", "settle"]);
    expect(pans(effects)).toEqual([[-5, -40]]);
  });

  it("zooms about the pointer under the Zoom setting", () => {
    const { effects } = run([wheel(1000, { deltaY: 100 })], { ...MOVE, wheelMode: "zoom" });
    expect(effects).toContainEqual({
      type: "zoom",
      point: { x: 100, y: 50 },
      factor: wheelZoomFactor(100),
    });
  });

  it("pans sideways with Shift", () => {
    expect(pans(run([wheel(1000, { deltaY: 30, shiftKey: true })]).effects)).toEqual([[-30, 0]]);
  });

  it("leaves a plain wheel over chrome to it, and zooms a pinch over chrome", () => {
    expect(run([wheel(1000, { deltaY: 30 }, { target: "chrome" })]).effects).toEqual([]);
    const pinch = run([wheel(1000, { deltaY: -4, ctrlKey: true }, { target: "chrome" })]);
    expect(pinch.effects).toContainEqual({ type: "prevent" });
    expect(pinch.effects).toContainEqual({
      type: "zoom",
      point: { x: 100, y: 50 },
      factor: ctrlZoomFactor(-4, true),
    });
  });

  it("ignores an event something below already handled", () => {
    expect(run([wheel(1000, { deltaY: 30 }, { defaultPrevented: true })]).effects).toEqual([]);
  });

  it("starts a gesture once per sequence", () => {
    const { effects } = run([
      wheel(1000, { deltaY: 10 }),
      wheel(1000 + WHEEL_SETTLE_MS - 1, { deltaY: 10 }),
      wheel(1000 + 2 * WHEEL_SETTLE_MS, { deltaY: 10 }),
    ]);
    expect(types(effects).filter((t) => t === "start")).toHaveLength(2);
    expect(types(effects).filter((t) => t === "settle")).toHaveLength(3);
  });

  it("swallows the rest of a sequence a command closed, until a gap", () => {
    const closed = run([wheel(1000, { deltaY: 10 }), { type: "closeWheel" }]);
    const tail = run(
      [
        wheel(1100, { deltaY: 10 }),
        wheel(1100 + WHEEL_SETTLE_MS - 1, { deltaY: 10 }),
        wheel(1100 + 2 * WHEEL_SETTLE_MS - 2, { deltaY: 10 }),
      ],
      MOVE,
      closed.state,
    );
    // Each tail event extends the quiet it has to wait out
    expect(types(tail.effects)).toEqual(["prevent", "prevent", "prevent"]);
    const after = run([wheel(1100 + 4 * WHEEL_SETTLE_MS, { deltaY: 10 })], MOVE, tail.state);
    expect(types(after.effects)).toEqual(["prevent", "start", "pan", "settle"]);
    expect(after.state.wheelClosed).toBe(false);
  });

  it("lets a new sequence through after a command with no wheel running", () => {
    const closed = run([{ type: "closeWheel" }]);
    const next = run([wheel(5000, { deltaY: 10 })], MOVE, closed.state);
    expect(types(next.effects)).toEqual(["prevent", "start", "pan", "settle"]);
  });
});

describe("pointer pans", () => {
  it("pans at once with the middle button and stops the mousedown", () => {
    const { state, effects } = run([
      down(1, 10, 10, { button: 1, hit: "draggable" }),
      move(1, 30, 15),
      up(1),
    ]);
    expect(types(effects)).toEqual([
      "preventMouseDown",
      "capture",
      "clearClick",
      "start",
      "pan",
      "prevent",
      "commit",
    ]);
    expect(pans(effects)).toEqual([[20, 5]]);
    expect(state.drag.kind).toBe("idle");
  });

  it("cancels only a middle release, moved or not, so no primary selection is pasted", () => {
    expect(types(run([down(1, 10, 10, { button: 1 }), up(1)]).effects)).toContain("prevent");
    const space = run([{ type: "spaceDown", focus: "canvas" }]).state;
    const spacePan = run([down(1, 0, 0), move(1, 3, 0), up(1)], MOVE, space);
    expect(types(spacePan.effects)).not.toContain("prevent");
    const dragged = run([down(1, 0, 0), move(1, 9, 0), up(1)]);
    expect(types(dragged.effects)).not.toContain("prevent");
  });

  it("pans with Space and the left button, over a picture too", () => {
    const space = run([{ type: "spaceDown", focus: "canvas" }]).state;
    const { effects } = run(
      [down(1, 0, 0, { hit: "draggable" }), move(1, 3, 0), up(1)],
      MOVE,
      space,
    );
    expect(types(effects)).toContain("capture");
    expect(pans(effects)).toEqual([[3, 0]]);
  });

  it("pans a left drag on empty canvas past the slop, from the press", () => {
    const { effects } = run([down(1, 0, 0), move(1, 2, 2), move(1, 6, 0), move(1, 9, 1), up(1)]);
    expect(types(effects)).toEqual(["capture", "clearClick", "start", "pan", "pan", "commit"]);
    expect(pans(effects)).toEqual([
      [6, 0],
      [3, 1],
    ]);
  });

  it("keeps a short left press a click", () => {
    const { state, effects } = run([down(1, 0, 0, { hit: "picker" }), move(1, 3, 0), up(1)]);
    expect(effects).toEqual([]);
    expect(state.drag.kind).toBe("idle");
  });

  it("uses a wider slop for touch", () => {
    const touch = { kind: "touch" as const };
    const short = run([down(1, 0, 0, touch), move(1, 8, 0, "touch")]);
    expect(short.effects).toEqual([]);
    const long = run([down(1, 0, 0, touch), move(1, 11, 0, "touch")]);
    expect(types(long.effects)).toEqual(["capture", "clearClick", "start", "withholdTouch", "pan"]);
  });

  it("leaves a left drag on a draggable node to Konva", () => {
    expect(run([down(1, 0, 0, { hit: "draggable" }), move(1, 50, 0), up(1)]).effects).toEqual([]);
  });

  it("never pans a left drag with the mask tools", () => {
    expect(run([down(1, 0, 0), move(1, 50, 0), up(1)], PAINT).effects).toEqual([]);
  });

  it("starts nothing on chrome", () => {
    expect(run([down(1, 0, 0, { target: "chrome", button: 1 }), move(1, 50, 0)]).effects).toEqual(
      [],
    );
    expect(run([down(1, 0, 0, { target: "chrome" }), move(1, 50, 0)]).effects).toEqual([]);
  });

  it("ends a pan that loses its pointer with a commit", () => {
    const { state, effects } = run([
      down(1, 0, 0, { button: 1 }),
      move(1, 5, 5),
      { type: "cancel", pointerId: 1, kind: "mouse" },
    ]);
    expect(types(effects).at(-1)).toBe("commit");
    expect(types(effects)).not.toContain("prevent");
    expect(state.drag.kind).toBe("idle");
  });
});

describe("pinch", () => {
  const touch = { kind: "touch" as const };

  it("cancels Konva's drags and pinches on a second finger, even over chrome", () => {
    const { state, effects } = run([
      down(1, 100, 100, { ...touch, hit: "draggable" }),
      down(2, 200, 100, { ...touch, target: "chrome" }),
      move(2, 300, 100, "touch"),
    ]);
    expect(types(effects)).toEqual(["interrupt", "clearClick", "withholdTouch", "start", "pinch"]);
    const pinch = effects.find((e) => e.type === "pinch");
    expect(pinch?.type === "pinch" && pinch.step.factor).toBe(2);
    expect(state.drag.kind).toBe("pinch");
  });

  it("takes over a one-finger pan", () => {
    const { effects } = run([
      down(1, 0, 0, touch),
      move(1, 20, 0, "touch"),
      down(2, 100, 0, touch),
      move(1, 10, 0, "touch"),
    ]);
    expect(types(effects).slice(-5)).toEqual([
      "interrupt",
      "clearClick",
      "withholdTouch",
      "start",
      "pinch",
    ]);
  });

  it("lets the finger left after a pinch start nothing", () => {
    const { state, effects } = run([
      down(1, 0, 0, touch),
      down(2, 100, 0, touch),
      up(2, "touch"),
      move(1, 60, 0, "touch"),
      move(1, 90, 0, "touch"),
    ]);
    expect(types(effects).slice(4)).toEqual(["commit"]);
    expect(state.drag.kind).toBe("spent");
    expect(run([up(1, "touch")], MOVE, state).state.drag.kind).toBe("idle");
  });

  it("ignores a third finger", () => {
    const pinching = run([down(1, 0, 0, touch), down(2, 100, 0, touch)]).state;
    expect(run([down(3, 50, 50, touch)], MOVE, pinching).effects).toEqual([]);
  });
});

describe("Space", () => {
  it("arms with focus on the page or the canvas", () => {
    const { state, effects } = run([{ type: "spaceDown", focus: "canvas" }]);
    expect(state.space).toBe("armed");
    expect(effects).toEqual([{ type: "prevent" }]);
    expect(run([{ type: "spaceUp" }], MOVE, state).state.space).toBe("up");
  });

  it("does nothing on a control over the canvas, and keeps it from pressing the control", () => {
    const { state, effects } = run([{ type: "spaceDown", focus: "chrome" }]);
    expect(state.space).toBe("blocked");
    expect(effects).toEqual([{ type: "prevent" }]);
    expect(run([{ type: "spaceUp" }], MOVE, state).effects).toEqual([{ type: "prevent" }]);
    expect(run([down(1, 0, 0, { hit: "draggable" }), move(1, 9, 0)], MOVE, state).effects).toEqual(
      [],
    );
  });

  it("types into a field", () => {
    const { state, effects } = run([{ type: "spaceDown", focus: "other" }, { type: "spaceUp" }]);
    expect(state.space).toBe("up");
    expect(effects).toEqual([]);
  });

  it("is released by a window blur, which also ends a pan", () => {
    const { state, effects } = run([
      { type: "spaceDown", focus: "canvas" },
      down(1, 0, 0),
      move(1, 5, 0),
      { type: "blur" },
    ]);
    expect(state.space).toBe("up");
    expect(state.drag.kind).toBe("idle");
    expect(effects.slice(-2)).toEqual([{ type: "release", pointerId: 1 }, { type: "commit" }]);
  });
});

describe("surfaceCursor", () => {
  it("grabs over empty canvas and grabs harder while panning", () => {
    expect(surfaceCursor(IDLE_GESTURES, MOVE, "none")).toBe("grab");
    expect(surfaceCursor(IDLE_GESTURES, MOVE, "shape")).toBe("grab");
    expect(surfaceCursor(IDLE_GESTURES, MOVE, "picker")).toBe("pointer");
    expect(surfaceCursor(IDLE_GESTURES, MOVE, "draggable")).toBe("");
    const panning = run([down(1, 0, 0, { button: 1 })]).state;
    expect(surfaceCursor(panning, PAINT, "none")).toBe("grabbing");
  });

  it("leaves the mask tools their own cursor unless Space is held", () => {
    expect(surfaceCursor(IDLE_GESTURES, PAINT, "none")).toBeNull();
    const space = run([{ type: "spaceDown", focus: "canvas" }]).state;
    expect(surfaceCursor(space, PAINT, "none")).toBe("grab");
  });
});
