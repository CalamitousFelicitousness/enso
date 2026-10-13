// A Gallery folder's name as the folder list gives it: a listed folder by its
// label, a folder under one by that label and the rest of its path.

import type { BrowserFolder } from "@/api/types/gallery";
import { TRASH_LABEL } from "./text";
import { isTrashFolder } from "./trash";

const trimmed = (path: string) => path.replace(/\/+$/, "");

export function folderLabel(path: string, folders: readonly BrowserFolder[]): string {
  if (isTrashFolder(path)) return TRASH_LABEL;
  const norm = trimmed(path);
  let best: BrowserFolder | null = null;
  for (const folder of folders) {
    const root = trimmed(folder.path);
    const holds = norm === root || norm.startsWith(`${root}/`);
    if (holds && (!best || root.length > trimmed(best.path).length)) best = folder;
  }
  if (!best) return norm.split("/").slice(-2).join("/");
  const rest = norm.slice(trimmed(best.path).length).replace(/^\/+/, "");
  return rest ? `${best.label}/${rest}` : best.label;
}
