export interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

type Listener = (vp: ViewportState) => void;

export interface ViewportBus {
  emit: (vp: ViewportState) => void;
  subscribe: (cb: Listener) => () => void;
}

export function createViewportBus(): ViewportBus {
  const listeners = new Set<Listener>();
  return {
    emit: (vp) => listeners.forEach((cb) => cb(vp)),
    subscribe: (cb) => {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
  };
}

export const mainViewportBus = createViewportBus();
export const videoViewportBus = createViewportBus();
