// Whether this browser opens Enso for the first time, judged at page start
// before anything is stored.

import { LOCAL, LOCAL_PREFIX } from "./names";

export type FirstRun =
  /** Nothing of Enso is kept here. */
  | "first"
  /** Kept from before the marker existed: not a first run. */
  | "existing"
  | "marked";

export function firstRunState(marker: string | null, keys: readonly string[]): FirstRun {
  if (marker !== null) return "marked";
  const kept = keys.some(
    (key) => key.startsWith(LOCAL_PREFIX) && key !== LOCAL.reset && key !== LOCAL.profile,
  );
  return kept ? "existing" : "first";
}
