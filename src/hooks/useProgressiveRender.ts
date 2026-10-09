import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_BATCH = 40;

/** Render a long list in batches: one at once, the next whenever the
 * sentinel after the last rendered item comes into view. The count goes back
 * to one batch when `resetKey` changes (by default, whenever the items do);
 * `reveal(index)` renders up to that item. */
export function useProgressiveRender<T>(
  items: readonly T[],
  batchSize: number = DEFAULT_BATCH,
  resetKey: unknown = items,
) {
  const [extraBatches, setExtraBatches] = useState(0);
  const [prevKey, setPrevKey] = useState(resetKey);
  const sentinelRef = useRef<HTMLDivElement>(null);

  if (prevKey !== resetKey) {
    setPrevKey(resetKey);
    if (extraBatches !== 0) setExtraBatches(0);
  }

  const renderCount = Math.min(batchSize + extraBatches * batchSize, items.length);
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

  const reveal = useCallback(
    (index: number) => {
      setExtraBatches((c) => Math.max(c, Math.ceil((index + 1 - batchSize) / batchSize)));
    },
    [batchSize],
  );

  return {
    visibleItems: items.slice(0, renderCount),
    sentinelRef,
    hasMore,
    reveal,
  };
}
