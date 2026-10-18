/** How many columns a width holds at tiles of at least `minSize`, with `gap`
 * between the tiles and at both edges, and the tile size that then fills it. */
export function gridColumns(
  width: number,
  minSize: number,
  gap: number,
  minCols = 1,
): { cols: number; size: number } {
  const cols = Math.max(minCols, Math.floor((width - gap) / (minSize + gap)));
  return { cols, size: Math.max(0, (width - (cols + 1) * gap) / cols) };
}
