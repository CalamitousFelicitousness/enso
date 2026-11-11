import { useCallback, useEffect, useRef, useState } from "react";

/** Steps closer together than this are one commit. */
const BURST_MS = 300;

/**
 * Steps from keys or the wheel that commit once they stop: each shows at once
 * as `pending`, and the last commits BURST_MS after it. Nothing is written when
 * the burst ends where it began.
 */
export function useStepBurst(value: number, onCommit: (value: number) => void) {
  const [pending, setPending] = useState<number | null>(null);
  const burst = useRef<{ value: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const latest = useRef({ value, onCommit });
  useEffect(() => {
    latest.current = { value, onCommit };
  });

  const drop = useCallback(() => {
    const b = burst.current;
    if (b) clearTimeout(b.timer);
    burst.current = null;
    setPending(null);
    return b?.value ?? null;
  }, []);

  /** Writes `next` unless it is the value in effect, dropping any burst. */
  const commit = useCallback(
    (next: number) => {
      drop();
      if (next !== latest.current.value) latest.current.onCommit(next);
    },
    [drop],
  );

  /** Commits the burst now; returns its value, or null when none was running. */
  const flush = useCallback(() => {
    const next = burst.current?.value ?? null;
    if (next !== null) commit(next);
    return next;
  }, [commit]);

  /** One step, from the burst's value or the value in effect. */
  const step = useCallback(
    (to: (from: number) => number) => {
      const next = to(burst.current?.value ?? latest.current.value);
      if (burst.current) clearTimeout(burst.current.timer);
      burst.current = { value: next, timer: setTimeout(flush, BURST_MS) };
      setPending(next);
    },
    [flush],
  );

  // a burst cut short by unmounting still commits
  useEffect(() => () => void flush(), [flush]);

  return { pending, step, flush, commit };
}

/**
 * A Radix slider that writes once per gesture: on release, or once a burst of
 * key steps ends. `shown` is the value to display; spread `bind` on the Slider.
 */
export function useCommittedSlider(value: number, onCommit: (value: number) => void) {
  const keys = useStepBurst(value, onCommit);
  const dragging = useRef(false);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? keys.pending ?? value;
  return {
    shown,
    bind: {
      value: [shown],
      onPointerDown: () => {
        keys.flush();
        dragging.current = true;
      },
      onLostPointerCapture: () => {
        dragging.current = false;
        setDrag(null);
      },
      onValueChange: ([v]: number[]) => {
        if (dragging.current) setDrag(v);
      },
      onValueCommit: ([v]: number[]) => {
        if (!dragging.current) return keys.step(() => v);
        setDrag(null);
        keys.commit(v);
      },
    },
  };
}
