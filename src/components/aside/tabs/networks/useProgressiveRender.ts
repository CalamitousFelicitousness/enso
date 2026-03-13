import { useState, useEffect, useRef } from "react";

const DEFAULT_BATCH = 40;

export function useProgressiveRender<T>(
  items: T[],
  batchSize: number = DEFAULT_BATCH,
) {
  const [extraBatches, setExtraBatches] = useState(0);
  const [prevItems, setPrevItems] = useState(items);
  const sentinelRef = useRef<HTMLDivElement>(null);

  if (prevItems !== items) {
    setPrevItems(items);
    if (extraBatches !== 0) setExtraBatches(0);
  }

  const renderCount = Math.min(
    batchSize + extraBatches * batchSize,
    items.length,
  );
  const hasMore = renderCount < items.length;

  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        setExtraBatches((c) => c + 1);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [renderCount, items.length, hasMore]);

  return {
    visibleItems: items.slice(0, renderCount),
    sentinelRef,
    hasMore,
  };
}
