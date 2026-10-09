// Which items a capped collection lets go of.

/** The ids of the items past the first `cap` in `order` that `keep` does not
 * name, the last in order first. */
export function planTrim<T extends { id: string }>(
  items: readonly T[],
  cap: number,
  keep: ReadonlySet<string>,
  order: (a: T, b: T) => number,
): string[] {
  if (items.length <= cap) return [];
  return [...items]
    .sort(order)
    .slice(cap)
    .filter((item) => !keep.has(item.id))
    .reverse()
    .map((item) => item.id);
}
