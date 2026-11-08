import type { Size, Viewport } from "@/lib/viewport/types";

export type ViewportState = Viewport;

type Listener = (vp: ViewportState, container: Size) => void;

export interface ViewportBus {
  emit: (vp: ViewportState, container: Size) => void;
  subscribe: (cb: Listener) => () => void;
}

export function createViewportBus(): ViewportBus {
  const listeners = new Set<Listener>();
  return {
    emit: (vp, container) => listeners.forEach((cb) => cb(vp, container)),
    subscribe: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
