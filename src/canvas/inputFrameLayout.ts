// Pure layout helpers for the multi-Input-frame stack. Constants and math;
// no React, no store dependencies, no Konva. The layout engine
// (useControlFrameLayout) consumes these to compute per-frame positions.

/** Vertical gap between Input frames in the stack, display units. */
export const INPUT_FRAME_GAP = 16;

/** Gap between adjacent reference children inside a Reference mother frame,
 * display units. Tighter than the inter-frame gap so children read as one
 * group instead of separated frames. */
export const REFERENCE_CHILD_GAP = 4;

/** Hard cap on reference grid columns. Beyond this, children become too
 * narrow to read at typical generation widths and the grid stops reading as
 * a grid. */
export const REFERENCE_MAX_COLUMNS = 4;

/** Padding inside the Reference mother frame between its border and the
 * child grid. Display units. Gives breathing room so the mother's chrome
 * doesn't crowd the children. */
export const REFERENCE_MOTHER_PADDING = 12;

/** Minimum display height for a reference child cell. When the mother
 * frame has few children, cells could shrink uncomfortably; this floor
 * keeps them legible. */
export const REFERENCE_MIN_CELL_HEIGHT = 96;

/** Pick a column count that produces a visually balanced grid for N
 * children. Conservative table - favors compact rectangles over tall 1xN
 * columns, caps at REFERENCE_MAX_COLUMNS so cells stay readable. The grid
 * is keyed on child count alone; the +Add affordance occupies a trailing
 * empty cell or sits below the grid when no slot is free. */
export function computeReferenceGridColumns(childCount: number): number {
  if (childCount <= 1) return 1;
  if (childCount === 2) return 2;
  if (childCount === 3) return 3;
  if (childCount === 4) return 2;
  if (childCount <= 6) return 3;
  return REFERENCE_MAX_COLUMNS;
}

/** Number of grid rows needed to fit N children at the chosen column count,
 * with an optional +Add cell included. Always returns at least 1 so an empty
 * Reference frame still shows the +Add affordance as a single cell. */
export function computeReferenceGridRows(
  childCount: number,
  columns: number,
  includeAddCell: boolean,
): number {
  const totalCells = childCount + (includeAddCell ? 1 : 0);
  if (totalCells === 0) return 1;
  return Math.max(1, Math.ceil(totalCells / Math.max(1, columns)));
}

export interface CellSize {
  cellW: number;
  cellH: number;
}

/** Partition the mother frame's content area (mother minus padding) into a
 * uniform cellW x cellH grid. Cells are square-ish; the underlying KonvaImage
 * is drawn with `contain` fit so the image aspect ratio is preserved inside
 * each cell. */
export function computeReferenceChildCellSize(
  motherContentW: number,
  motherContentH: number,
  columns: number,
  rows: number,
): CellSize {
  const safeCols = Math.max(1, columns);
  const safeRows = Math.max(1, rows);
  const gapW = REFERENCE_CHILD_GAP * (safeCols - 1);
  const gapH = REFERENCE_CHILD_GAP * (safeRows - 1);
  const cellW = Math.max(0, (motherContentW - gapW) / safeCols);
  const cellH = Math.max(REFERENCE_MIN_CELL_HEIGHT, (motherContentH - gapH) / safeRows);
  return { cellW, cellH };
}

/** Total height the mother frame needs to fit N children plus the optional
 * +Add cell at the given column count. Inverse of computeReferenceChildCellSize:
 * given the cell size we want, compute the mother height that accommodates
 * the grid. Used by the layout engine to size mother frames. */
export function computeReferenceMotherHeight(
  childCount: number,
  columns: number,
  cellH: number,
  includeAddCell: boolean,
): number {
  const rows = computeReferenceGridRows(childCount, columns, includeAddCell);
  const gapH = REFERENCE_CHILD_GAP * (rows - 1);
  return REFERENCE_MOTHER_PADDING * 2 + rows * cellH + gapH;
}
