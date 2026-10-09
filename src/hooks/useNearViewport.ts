import { useEffect, useState, type RefObject } from "react";

/** Whether the element is in or within `margin` of its scroll container's
 * view; it stays true once it has been, so work it started is not dropped. */
export function useNearViewport(ref: RefObject<Element | null>, margin = "200px"): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (near || !element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: margin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, margin, near]);
  return near;
}
