import { createViewportBus, type ViewportBus, type ViewportState } from "./viewportBus";
import { useCanvasStore } from "@/stores/canvasStore";
import { useVideoCanvasStore } from "@/stores/videoCanvasStore";

/** The slice of a canvas store the viewport layer touches. */
interface ViewportStore {
  getState: () => {
    viewport: ViewportState;
    setViewport: (v: Partial<ViewportState>) => void;
  };
  subscribe: (
    listener: (state: { viewport: ViewportState }, prev: { viewport: ViewportState }) => void,
  ) => () => void;
}

export interface ViewportAdapter {
  bus: ViewportBus;
  /** Last committed viewport; the base an overlay delta is measured against. */
  getCommitted: () => ViewportState;
  /** Freshest viewport, including a gesture that has not committed yet. */
  getViewport: () => ViewportState;
  setViewport: (v: Partial<ViewportState>) => void;
  /** Committed changes only: auto-fit, reset zoom, gesture end. */
  subscribe: (cb: (vp: ViewportState) => void) => () => void;
}

function createViewportAdapter(store: ViewportStore): ViewportAdapter {
  const bus = createViewportBus();
  let live = store.getState().viewport;
  bus.subscribe((vp) => {
    live = vp;
  });
  store.subscribe((state, prev) => {
    if (state.viewport !== prev.viewport) live = state.viewport;
  });
  return {
    bus,
    getCommitted: () => store.getState().viewport,
    getViewport: () => live,
    setViewport: (v) => store.getState().setViewport(v),
    subscribe: (cb) =>
      store.subscribe((state, prev) => {
        if (state.viewport !== prev.viewport) cb(state.viewport);
      }),
  };
}

// Paired here so a bus can never reach a canvas backed by the other store.
export const mainViewport = createViewportAdapter(useCanvasStore);
export const videoViewport = createViewportAdapter(useVideoCanvasStore);
