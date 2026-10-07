// The model's input image limit, applied to a change before it lands. A list
// already over the limit, reached through a model change or a restore, is a
// problem the outline reports; it can still be edited, as long as the edit
// adds no image.

import { computeOutline } from "./outline";
import type { Frame } from "./types";

/** Whether a change sends more images than `limit` and more than before. */
export function exceedsLimit(before: Frame[], after: Frame[], limit: number | null): boolean {
  if (limit === null) return false;
  const next = computeOutline(after).sent.length;
  return next > limit && next > computeOutline(before).sent.length;
}
