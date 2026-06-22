import { useEffect, type RefObject } from "react";

// Translate vertical wheel motion into horizontal scrolling on a container. A
// native non-passive listener is required because React registers onWheel as
// passive, which silently no-ops preventDefault(). An explicit horizontal
// intent (trackpad / shift+wheel) is left to native scroll.
export function useHorizontalWheel(ref: RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const handler = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [ref, enabled]);
}
