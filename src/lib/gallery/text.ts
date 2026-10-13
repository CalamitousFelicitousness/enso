// The words of the Gallery's trash, in one place: what a folder and the Trash
// folder say about files that went to the trash or came back.

import type { TrashFacts } from "@/api/types/gallery";
import { trashAgeText } from "@/lib/inputs/text";
import { aboutSize, type RemovedByOthers } from "@/lib/media/text";

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
const count = (n: number) => n.toLocaleString("en-US");
const filesText = (n: number) => (n === 1 ? "1 file" : `${count(n)} files`);
const goneText = (n: number) => `${n === 1 ? "It" : "They"} cannot be brought back.`;

export const TRASH_LABEL = "Trash";
export const MOVE_TO_TRASH = "Move to the trash";
export const DELETE_FILES_NOW = "Delete now";
export const RESTORE = "Restore";
export const RESTORE_TO = "Restore to...";
export const EMPTY_GALLERY_TRASH = "Empty the trash";
export const DELETED_LAST = "Deleted last";
export const DELETED_FIRST = "Deleted first";
export const FILE_LEFT_FOLDER = "The file is no longer in this folder";
export const TRASH_FAILED = "Could not move the files to the trash";
export const RESTORE_FAILED = "Could not restore the files";
export const DELETE_NOW_FAILED = "Could not delete the files";

// The server's reasons, for the slots that refuse before asking it
export const REFERENCE_KEPT = "The reference set is kept";
export const MODEL_FOLDERS_KEPT = "Model folders are kept";

/** '"00044.png" moved to the trash', "3 files moved to the trash". */
export function filesMovedToTrashText(n: number, name: string): string {
  return n === 1 ? `"${name}" moved to the trash` : `${count(n)} files moved to the trash`;
}

/** Asked before a large trash: the whole folder by its name, else the count. */
export function moveManyTitle(n: number, wholeFolder: string | null): string {
  return wholeFolder
    ? `Move all ${count(n)} files in ${wholeFolder} to the trash?`
    : `Move ${count(n)} files to the trash?`;
}

/** "2 files were not moved to the trash". */
export function notTrashedText(n: number): string {
  return n === 1
    ? "1 file was not moved to the trash"
    : `${count(n)} files were not moved to the trash`;
}

/** '"a.png" restored', "Restored 3 files". */
export function filesRestoredText(n: number, name: string): string {
  return n === 1 ? `"${name}" restored` : `Restored ${count(n)} files`;
}

/** What came back under another name, as the restore's toast says it. */
export function restoredAsText(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  return names.length === 1
    ? `Came back as "${names[0]}": another file has its name`
    : `${count(names.length)} came back under new names: other files have theirs`;
}

/** "Restored without a.txt": sidecars that stayed in the trash. */
export function restoredWithoutText(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const [first, ...rest] = names;
  return rest.length === 0
    ? `Restored without ${first}`
    : `Restored without ${first} and ${rest.length} more`;
}

/** 'Delete "a.png" now?', "Delete 3 files now?", or for everyone when other users' files are among them. */
export function deleteFilesNowTitle(n: number, name: string, everyone: boolean): string {
  const what = n === 1 ? `"${name}"` : `${count(n)} files`;
  return everyone ? `Delete ${what} for everyone?` : `Delete ${what} now?`;
}

/** The Delete now dialog: from a folder the sidecars go with each file; from the trash it names whose files they are. */
export function deleteFilesNowText(fromTrash: boolean, n: number, others: RemovedByOthers): string {
  if (!fromTrash) {
    return `Files saved beside ${n === 1 ? "it" : "them"} under the same name, such as the .txt, go too. ${goneText(n)}`;
  }
  if (others.count === 0) return goneText(n);
  const who = others.name ?? "Other users";
  const which = others.count === n ? (n === 1 ? "it" : "them") : `${count(others.count)} of them`;
  return `${who} deleted ${which}. ${goneText(n)}`;
}

/** "412 files · about 1.2 GB · kept for 7 days": the Trash folder's line. */
export function trashFolderText(total: number, bytes: number, days: number): string {
  const kept = `kept for ${plural(days, "day", "days")}`;
  if (total === 0) return `No files in the trash · ${kept}`;
  return `${filesText(total)} · ${aboutSize(bytes)} · ${kept}`;
}

/** What Empty asks before it deletes every file in the trash for everyone. */
export function emptyGalleryTrashText(
  total: number,
  bytes: number,
  others: RemovedByOthers,
): string {
  const whose =
    others.count === 0
      ? ""
      : others.name
        ? ` (${count(others.count)} deleted by ${others.name})`
        : ` (${count(others.count)} deleted by others)`;
  const files = total === 1 ? "the 1 file" : `all ${count(total)} files`;
  const freed = bytes > 0 ? ` ${aboutSize(bytes).replace(/^about/, "About")} is freed.` : "";
  return `Delete ${files} in the trash for everyone${whose}?${freed} ${goneText(total)}`;
}

/** "Was in outputs/text/Qwen-Image-2.1". */
export function wasInText(folder: string): string {
  return `Was in ${folder}`;
}

/** "5 selected · 2 hidden by the search". */
export function hiddenBySearchText(n: number): string {
  return `${count(n)} hidden by the search`;
}

/** "2 files hidden by the search were left". */
export function hiddenLeftText(n: number): string {
  return n === 1
    ? "1 file hidden by the search was left"
    : `${count(n)} files hidden by the search were left`;
}

/** '"a.png" deleted', "3 files deleted": Delete now from the trash, and Empty. */
export function filesDeletedText(n: number, name: string): string {
  return n === 1 ? `"${name}" deleted` : `${count(n)} files deleted`;
}

/** "2 files were not restored". */
export function notRestoredText(n: number): string {
  return n === 1 ? "1 file was not restored" : `${count(n)} files were not restored`;
}

export const NOTHING_SELECTED = "Select files first";
export const TRASH_EMPTY = "Nothing in the trash";
export const READING_TRASH = "Reading the trash";
export const TRASH_UNREADABLE = "Could not read the trash";

/** What the large trash asks says about the files after it. */
export function moveManyText(days: number): string {
  return `They and the files saved beside them stay in the trash for ${plural(days, "day", "days")}.`;
}

/** "Restore 3 files to...": the folder picker of Restore to... */
export function restoreToTitle(n: number): string {
  return n === 1 ? "Restore 1 file to..." : `Restore ${count(n)} files to...`;
}

/** Where a trashed file was, and who deleted it, when and how long it stays:
 * the panel stacks the two, the lightbox joins them. */
export function trashLineParts(trash: TrashFacts, now: number): [string, string] {
  if (trash.lost) return [wasInText(trash.from), "its file is missing from the trash"];
  const age = trashAgeText(
    {
      removedAt: trash.trashedAt,
      expiresAt: trash.expiresAt,
      source: "file",
      by: trash.trashedBy,
      cause: "removed",
    },
    now,
  );
  return [wasInText(trash.from), age];
}

/** "Was in outputs/text · deleted by alice 3 h ago · 6 days left". */
export function trashLineText(trash: TrashFacts, now: number): string {
  return trashLineParts(trash, now).join(" · ");
}
