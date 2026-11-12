// Replay: write one side of a step through its slices in one tick. The
// recorder is deaf while it runs and the gesture ends after it, so nothing the
// writes set off can become a step.

import type { Side, Step } from "@/lib/undo/types";
import type { Recorder } from "./recorder";
import type { Slice } from "./slice";

/** What the app does around a replay. */
export interface ReplayHooks {
  /** Wraps the writes: the Images size sync stays still through them. */
  readonly around: (write: () => void) => void;
  /** After the writes, inside `around`: Width and Height back on the model's multiple. */
  readonly settle: (step: Step, side: Side) => void;
  /** After the replay: bring what it touched into view. */
  readonly show: (step: Step, side: Side) => void;
}

export const NO_HOOKS: ReplayHooks = {
  around: (write) => write(),
  settle: () => {},
  show: () => {},
};

export function replay(
  step: Step,
  side: Side,
  slices: ReadonlyMap<string, Slice>,
  recorder: Recorder,
  hooks: ReplayHooks,
): void {
  recorder.replaying(() =>
    hooks.around(() => {
      for (const patch of [...step.patches, ...step.riders]) {
        const slice = slices.get(patch.slice);
        if (!slice) throw new Error(`No slice ${patch.slice} to replay`);
        slice.write(patch, side, step.context?.[side]);
      }
      hooks.settle(step, side);
    }),
  );
  hooks.show(step, side);
}
