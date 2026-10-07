// How a stored enso-ui record meets the current defaults: one level deep, so
// a key added later keeps its default, and renamed values find their new name.

/** Images sub-tab ids older builds stored, by their current id. */
const RENAMED_IMAGES_TABS: Record<string, string> = { control: "input" };

/** Settings older builds stored that no longer exist. */
const DROPPED_KEYS = ["reprocessOnGenerate"];

interface UiShape {
  activeImagesSubTab: string;
  panelSelections: object;
}

/** Zustand merges persisted state with a shallow spread, so a blob written
 * before a panelSelections key existed would reinstate the whole object and
 * leave that key undefined. Exactly one level deep: array fields elsewhere
 * must still be replaced, not merged. */
export function mergeUiState<S extends UiShape>(persisted: unknown, current: S): S {
  const saved = { ...((persisted ?? {}) as Partial<S>) };
  for (const key of DROPPED_KEYS) delete (saved as Record<string, unknown>)[key];
  const stored = saved.activeImagesSubTab;
  const activeImagesSubTab =
    typeof stored === "string"
      ? (RENAMED_IMAGES_TABS[stored] ?? stored)
      : current.activeImagesSubTab;
  return {
    ...current,
    ...saved,
    activeImagesSubTab,
    panelSelections: { ...current.panelSelections, ...(saved.panelSelections ?? {}) },
  };
}
