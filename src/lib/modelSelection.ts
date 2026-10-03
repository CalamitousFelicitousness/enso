import type { UnifiedModel } from "@/api/types/cloud";

/** Whether the selection becomes the server's loaded image model. A local
 * image selection differs from the loaded model only between the user's pick
 * and that pick's load: it follows the loaded model when the server first
 * reports it after a page load and whenever it changes. Cloud and video
 * selections are not the server's image model and stay. */
export function followsLoaded(
  loadedTitle: string | null,
  previousLoadedTitle: string | null | undefined,
  selected: UnifiedModel | null,
): boolean {
  if (loadedTitle === null || loadedTitle === previousLoadedTitle) return false;
  if (selected === null) return true;
  return selected.source === "local" && selected.title !== loadedTitle;
}
