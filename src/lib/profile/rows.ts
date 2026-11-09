// Which rows the dialog and the panel show, and which start checked.

import { CONTENT_ROWS, RESET_ROWS, type ResetRow } from "./manifest";
import type { ProfileMeasure } from "./text";

/** Checked when the dialog opens. The connection and what never moved to
 * the server are what a user regrets losing most, so they start unchecked. */
export const DEFAULT_ROWS: readonly ResetRow[] = CONTENT_ROWS;

/** Every row, but Not yet on the server only while an older version's
 * entries or records are held here. */
export function shownRows(measure: ProfileMeasure | null): ResetRow[] {
  const held = measure !== null && measure.heldEntries + measure.heldRecords > 0;
  return RESET_ROWS.filter((row) => row !== "legacy" || held);
}

/** All four content rows are chosen: the caches go too. */
export function clearsContent(rows: ReadonlySet<ResetRow>): boolean {
  return CONTENT_ROWS.every((row) => rows.has(row));
}
