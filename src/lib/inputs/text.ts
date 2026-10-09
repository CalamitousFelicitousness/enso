// The words for inputs, in one place: the canvas, the Input tab, toasts and
// accessible names all read them from here.

import type {
  Address,
  MapSlot,
  MapState,
  NotSentReason,
  Outline,
  OutlineEntry,
  OutlineProblem,
  SentInput,
} from "./outline";
import type { AddressChange } from "./renumber";
import type { StoredEntry, StoredFrame, StoredRemoval } from "./stored";
import {
  isComposed,
  type ControlType,
  type Frame,
  type FrameRole,
  type MediaKind,
  type Size,
} from "./types";

const KIND: Record<MediaKind, string> = { image: "Image", video: "Video", audio: "Audio" };
const ROLE: Record<FrameRole, string> = {
  initial: "Initial",
  reference: "Reference",
  control: "Control",
  ipAdapter: "IP-Adapter",
};
const CONTROL_TYPE: Record<ControlType, string> = {
  controlnet: "ControlNet",
  t2i: "T2I-Adapter",
  xs: "XS",
  lite: "Lite",
  style_transfer: "Style Transfer",
};
const NOT_SENT: Record<NotSentReason, string> = {
  noModel: "no model",
  noPicture: "no picture",
  linkBroken: "its source frame is gone",
};

export function roleLabel(role: FrameRole): string {
  return ROLE[role];
}

export function controlTypeLabel(type: ControlType): string {
  return CONTROL_TYPE[type];
}

/** "Input 2": a frame by its place in the list. */
export function positionLabel(position: number): string {
  return `Input ${position}`;
}

/** "Input 2", "Inputs 2-3" for a run, "Inputs 2, 4" otherwise. */
export function positionsLabel(positions: number[]): string {
  const sorted = [...new Set(positions)].sort((a, b) => a - b);
  if (sorted.length === 1) return positionLabel(sorted[0]);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const run = last - first === sorted.length - 1;
  return `Inputs ${run ? `${first}-${last}` : sorted.join(", ")}`;
}

/** "Image 3": a sent picture by the number a prompt uses. */
export function addressLabel(address: Address): string {
  return `${KIND[address.kind]} ${address.n}`;
}

/** "Image 2", "Image 2-4", "Image 2, Video 1": addresses as ranges per kind.
 * Null for none. */
export function addressesLabel(addresses: Address[]): string | null {
  if (addresses.length === 0) return null;
  const numbers = new Map<MediaKind, number[]>();
  for (const address of addresses) {
    numbers.set(address.kind, [...(numbers.get(address.kind) ?? []), address.n]);
  }
  return [...numbers]
    .map(([kind, ns]) => {
      const first = Math.min(...ns);
      const last = Math.max(...ns);
      return first === last ? `${KIND[kind]} ${first}` : `${KIND[kind]} ${first}-${last}`;
    })
    .join(", ");
}

/** What a frame sends, as `addressesLabel`. Null when it sends nothing. */
export function sentLabel(sent: SentInput[]): string | null {
  return addressesLabel(sent.map((s) => s.address));
}

/** "Not sent: no model". */
export function notSentLabel(reason: NotSentReason): string {
  return `Not sent: ${NOT_SENT[reason]}`;
}

/** "uses Input 1": a Control frame that sends another frame's picture. */
export function linkedLabel(position: number): string {
  return `uses ${positionLabel(position)}`;
}

const MAP_STATE: Record<MapState, string> = {
  current: "current",
  needed: "needs processing",
  queued: "queued",
  processing: "processing",
  failed: "failed",
  unknown: "",
};

/** One word for where a map stands; nothing while the cache has not answered. */
export function mapStateWord(state: MapState): string {
  return MAP_STATE[state];
}

/** The states of several maps as the worst of them, with a count when they
 * differ: "1 of 4 failed", "2 of 4 processing", "current". Null for none. */
export function mapsWord(maps: MapSlot[]): string | null {
  if (maps.length === 0) return null;
  const order: MapState[] = ["failed", "processing", "queued", "needed", "unknown", "current"];
  const worst = order.find((state) => maps.some((m) => m.state === state)) ?? "current";
  const n = maps.filter((m) => m.state === worst).length;
  const word = MAP_STATE[worst];
  if (n === maps.length || word === "") return word;
  return worst === "needed"
    ? `${n} of ${maps.length} need processing`
    : `${n} of ${maps.length} ${word}`;
}

/** One word for what a frame does in the next request. A sent frame whose
 * maps are not all current says where they stand instead. */
export function statusWord(entry: OutlineEntry): string {
  if (entry.blockedBy.length > 0) return "blocked";
  switch (entry.status) {
    case "off":
      return "off";
    case "empty":
      return "empty";
    case "notSent":
      return "not sent";
    case "sent": {
      const maps = mapsWord(entry.maps);
      return maps && maps !== "current" ? maps : "sent";
    }
  }
}

/** Result kinds sdnext's processor groups stand for, shown before the tool name. */
const RESULT_KIND: Record<string, string> = {
  Pose: "Pose",
  Edge: "Edges",
  Depth: "Depth",
  Normal: "Normals",
  Segmentation: "Segments",
};

/** "Depth · Depth Anything V2 Small": what a processor makes, then its name. */
export function processToLabel(group: string | null, name: string): string {
  const kind = group === null ? null : (RESULT_KIND[group] ?? null);
  return kind ? `${kind} · ${name}` : name;
}

/** The Process to choice that leaves pictures as they are. */
export const PROCESS_TO_NONE = "Nothing";

/** "Send as Image 3 instead": a Control frame without a model, sent as an image. */
export function sendAsImageLabel(address: Address): string {
  return `Send as ${addressLabel(address)} instead`;
}

/** Detail only runs on the first Initial frame's pictures, which a processor would replace. */
export function detailProcessedText(position: number): string {
  return `Detail only runs on the picture itself, and ${positionLabel(position)} is processed to a map`;
}

/** The map's processor failed, with the server's reason. */
export function mapFailedText(reason: string): string {
  return `Processing failed: ${reason}`;
}

/** What asking for maps came to: a job started, nothing to do and why, or
 * a start that failed (said by its own notice). */
export type ProcessOutcome = "started" | "none" | "current" | "busy" | "unavailable" | "failed";

const PROCESS_OUTCOME: Record<Exclude<ProcessOutcome, "started" | "failed">, string> = {
  none: "No input that is sent has a processor",
  current: "Every map is current",
  busy: "The maps are already being made",
  unavailable: "The server has not listed its processors yet",
};

export function processOutcomeText(outcome: Exclude<ProcessOutcome, "started" | "failed">): string {
  return PROCESS_OUTCOME[outcome];
}

/** Why a frame with a processor has no map: the server has not listed its
 * processors, or the frame sends nothing. */
export function noMapText(entry: OutlineEntry, listed: boolean): string {
  if (!listed) return PROCESS_OUTCOME.unavailable;
  switch (entry.status) {
    case "off":
      return "The frame is off, so nothing is processed";
    case "notSent":
      return "Not sent, so nothing is processed";
    default:
      return "Nothing to process yet";
  }
}

function unreadableAt(positions: number[]): string | null {
  if (positions.length === 0) return null;
  return `A stored picture in ${positionsLabel(positions)} could not be read. Replace or remove it.`;
}

/** Why a job cannot be built from these inputs, or null. */
export function unreadableText(entries: OutlineEntry[]): string | null {
  return unreadableAt(
    entries.filter((e) => e.sent.some((s) => s.unreadable)).map((e) => e.position),
  );
}

/** The same, for the pictures Control and IP-Adapter frames send. */
export function unreadableControlText(
  outline: Pick<Outline, "controls" | "ipAdapters">,
): string | null {
  return unreadableAt(
    [...outline.controls, ...outline.ipAdapters].filter((s) => s.unreadable).map((s) => s.position),
  );
}

const imagesSent = (images: number) =>
  images > 1 ? "several input images" : "a Reference image sent at the size you set";

/** Why the request cannot carry the frames as they stand. */
export function problemText(problem: OutlineProblem): string {
  switch (problem.code) {
    case "mixedControlTypes": {
      const frames = problem.frames
        .map((f) => `${positionLabel(f.position)} (${CONTROL_TYPE[f.type]})`)
        .join(", ");
      return `Control frames must share one type: ${frames}.`;
    }
    case "tooManyImages": {
      const takes = problem.limit === 1 ? "one input image" : `up to ${problem.limit} input images`;
      return `This model takes ${takes}; the frames send ${problem.sent}.`;
    }
    case "unreadable":
      return unreadableAt(problem.positions) ?? "";
    case "maskWithSet":
      return `The mask on ${positionsLabel(problem.positions)} cannot be sent with ${imagesSent(problem.images)}.`;
    case "controlWithSet":
      return `${positionsLabel(problem.positions)} cannot be sent with ${imagesSent(problem.images)}.`;
    case "cloudMaps":
      return `This model runs elsewhere and cannot process pictures: ${positionsLabel(problem.positions)} must be processed first.`;
  }
}

/** What the fix for a problem does, as a button label. */
export function fixLabel(problem: OutlineProblem): string {
  switch (problem.code) {
    case "mixedControlTypes": {
      const keep = problem.frames[0]?.type;
      const others = problem.frames.filter((f) => f.type !== keep).map((f) => f.position);
      return `Turn off ${positionsLabel(others)}`;
    }
    case "tooManyImages": {
      // pictures of set frames can be hidden one by one; a composite only with its frame
      const composed = problem.over.filter((o) => o.pictureId === null);
      if (composed.length > 0) return `Turn off ${positionsLabel(problem.positions)}`;
      return `Hide ${addressesLabel(problem.over.map((o) => o.address)) ?? ""}`;
    }
    case "controlWithSet":
      return `Turn off ${positionsLabel(problem.positions)}`;
    case "unreadable":
      return "Remove the unreadable pictures";
    case "maskWithSet":
      return "Clear the mask";
    case "cloudMaps":
      return "Process now";
  }
}

/** "Image 4 is now Image 2, Image 5 is now Image 3". Null without a change. */
export function renumberText(changes: AddressChange[]): string | null {
  if (changes.length === 0) return null;
  return changes.map((c) => `${addressLabel(c.from)} is now ${addressLabel(c.to)}`).join(", ");
}

/** The picked size source is no longer sent, so Width and Height stay. */
export const SIZE_SOURCE_LOST_TEXT =
  "The image the size came from is no longer sent. Width and Height stay as they are.";
export const SIZE_SOURCE_FIRST_LABEL = "Use Image 1";

/** The server predates the sdnext change that lets a control unit keep its own picture beside an Initial picture. */
export const CONTROL_PICTURE_SERVER_TEXT =
  "Control pictures beside an Initial picture need a newer sdnext (the control fix of 2026-10-05). Update the server, or turn the control units off.";

/** "Reference", "ControlNet": what a frame does, by its control type when it is a Control frame. */
export function frameRoleLabel(frame: Pick<Frame, "role" | "control">): string {
  return frame.role === "control" ? controlTypeLabel(frame.control.type) : roleLabel(frame.role);
}

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** "Added as Input 3", "Added as Inputs 3-4". */
export function addedText(positions: number[]): string {
  return `Added as ${positionsLabel(positions)}`;
}

/** "Input 2 duplicated as Input 5". */
export function duplicatedText(from: number, to: number): string {
  return `${positionLabel(from)} duplicated as ${positionLabel(to)}`;
}

export const NOTHING_TO_SAVE = "Nothing to save";

/** Why a Control frame that uses another frame's picture is not saved on its own. */
export function linkedSaveText(position: number, source: number): string {
  return `${positionLabel(position)} uses ${positionLabel(source)}'s picture; save ${positionLabel(source)} or the inputs as a set`;
}

/** 'Saved as "Portrait"'. */
export function savedText(name: string): string {
  return `Saved as "${name}"`;
}

/** "for 7 days": how long the trash keeps what goes to it. */
export function keptForText(days: number): string {
  return `for ${plural(days, "day", "days")}`;
}

/** What a save pushed out of the library: '"Old" left the library and is in
 * the trash for 7 days', or a count of entries. */
export function evictedText(names: string[], days: number): string {
  return names.length === 1
    ? `"${names[0]}" left the library and is in the trash ${keptForText(days)}`
    : `${names.length} entries left the library and are in the trash ${keptForText(days)}`;
}

/** 'Inputs replaced with "Portrait" at 1024×1024'. */
export function replacedWithText(name: string, size: Size): string {
  return `Inputs replaced with "${name}" at ${size.width}×${size.height}`;
}

/** 'One picture of "Portrait" could not be read', or a count. */
export function lostEntryPicturesText(n: number, name: string): string {
  return n === 1
    ? `One picture of "${name}" could not be read`
    : `${n} pictures of "${name}" could not be read`;
}

/** '"Portrait" moved to the trash'. */
export function entryTrashedText(name: string): string {
  return `"${name}" moved to the trash`;
}

/** "Up to 20 entries can be pinned". */
export function pinLimitText(max: number): string {
  return `Up to ${max} entries can be pinned`;
}

export const NO_LONGER_IN_LIBRARY = "No longer in the library";
export const RECALL_FAILED = "Could not read the saved inputs";
export const SAVE_FAILED = "Could not save to the library";
export const SHOW_IN_LIBRARY = "Show in library";

export type EntryChange = "rename" | "pin" | "unpin" | "trash" | "delete";

const ENTRY_CHANGE_FAILED: Record<EntryChange, (name: string) => string> = {
  rename: (name) => `Could not rename "${name}"`,
  pin: (name) => `Could not pin "${name}"`,
  unpin: (name) => `Could not unpin "${name}"`,
  trash: (name) => `Could not move "${name}" to the trash`,
  delete: (name) => `Could not delete "${name}"`,
};

/** 'Could not rename "Portrait"': a change to an entry that was not stored. */
export function entryChangeFailedText(change: EntryChange, name: string): string {
  return ENTRY_CHANGE_FAILED[change](name);
}

/** '"Portrait" deleted'. */
export function entryDeletedText(name: string): string {
  return `"${name}" deleted`;
}

export const DELETE_INSTEAD = "Storage is full. Delete it for good instead?";
export const DELETE_FOR_GOOD = "Delete";
export const UNREADABLE_DELETE_FAILED = "Could not delete the entry";

/** "Frame · Reference · 3 pictures", "Set · 4 inputs · 1024×1024": what an entry holds. */
export function entryLine(
  kind: "frame" | "set",
  frames: readonly (Pick<Frame, "role" | "control"> & { pictures: readonly unknown[] })[],
  size: Size,
): string {
  if (kind === "set") {
    return `Set · ${plural(frames.length, "input", "inputs")} · ${size.width}×${size.height}`;
  }
  const [frame] = frames;
  const pictures = frame ? frame.pictures.length : 0;
  const role = frame ? frameRoleLabel(frame) : "";
  return `Frame · ${role} · ${plural(pictures, "picture", "pictures")}`;
}

export const ADD_TO_INPUTS = "Add to inputs";
export const REPLACE_INPUTS = "Replace inputs";
export const PIN_ENTRY = "Pin";
export const UNPIN_ENTRY = "Unpin";
export const REMOVE_ENTRY = "Remove";
export const RENAME_ENTRY = "Rename";
export const SAVE_TO_LIBRARY = "Save to library";
export const SAVE_FRAME = "Save frame";
export const SAVE_SET = "Save these inputs as a set";
export const DUPLICATE_FRAME = "Duplicate";
export const NOTHING_TO_DUPLICATE = "Nothing to duplicate";
export const LIBRARY_EMPTY =
  "Nothing saved yet. Save a frame from the bar above it, or the inputs from the Input tab.";
export const LIBRARY_NO_MATCH = "No saved inputs match the search";
export const NEWER_ENTRY = "Saved by a newer version of Enso";
export const DELETE_ENTRY = "Delete";

/** What clicking a card does, short: a frame is added, a set takes the inputs' place. */
export function entryVerb(kind: "frame" | "set"): string {
  return kind === "set" ? "Replaces inputs" : "Adds to inputs";
}

/** What clicking a card does, in full. */
export function entryVerbHint(kind: "frame" | "set"): string {
  return kind === "set"
    ? "Clicking the card puts this set in the place of the inputs"
    : "Clicking the card adds this frame after the inputs";
}

/** A card's accessible name: '"Portrait", set of 4 inputs, pinned; Enter replaces the inputs'. */
export function entryName(
  name: string,
  kind: "frame" | "set",
  frames: readonly (Pick<Frame, "role" | "control"> & { pictures: readonly unknown[] })[],
  pinned: boolean,
): string {
  const what =
    kind === "set"
      ? `set of ${plural(frames.length, "input", "inputs")}`
      : `${frames[0] ? frameRoleLabel(frames[0]) : "empty"} frame, ${plural(frames[0]?.pictures.length ?? 0, "picture", "pictures")}`;
  const verb = kind === "set" ? "Enter replaces the inputs" : "Enter adds it to the inputs";
  return `"${name}", ${what}${pinned ? ", pinned" : ""}; ${verb}`;
}

/** "38 of 100 · 4 pinned": the unpinned entries against the cap, and the pins. */
export function libraryCountText(unpinned: number, cap: number, pinned: number): string {
  return pinned > 0 ? `${unpinned} of ${cap} · ${pinned} pinned` : `${unpinned} of ${cap}`;
}

/** "no model": a not-sent reason short enough for a header chip. */
export function notSentReason(reason: NotSentReason): string {
  return NOT_SENT[reason];
}

const describeFrame = (frame: StoredFrame): string => {
  const what = isComposed(frame.role) ? ["layer", "layers"] : ["picture", "pictures"];
  return `${frameRoleLabel(frame)}, ${plural(frame.pictures.length, what[0], what[1])}`;
};

/** What a frame's emptied or replaced content held: "2 layers, mask". */
function contentsLabel(frame: StoredFrame): string {
  const parts: string[] = [];
  const what = isComposed(frame.role) ? ["layer", "layers"] : ["picture", "pictures"];
  if (frame.pictures.length > 0) parts.push(plural(frame.pictures.length, what[0], what[1]));
  if (frame.mask.objects.length > 0 || frame.mask.strokes.length > 0) parts.push("mask");
  if (frame.ipAdapter.masks.length > 0) {
    parts.push(plural(frame.ipAdapter.masks.length, "region mask", "region masks"));
  }
  return parts.join(", ") || "settings";
}

/** A removal as the trash names it: "Input 2 (Reference, 3 pictures)",
 * "cat.png, from Input 2", "Cleared from Input 1: 2 layers, mask",
 * "Cleared inputs (4 inputs)". */
export function removalTitle({ cause, from, content }: StoredRemoval): string {
  const where = positionLabel(from.position);
  switch (content.kind) {
    case "frame":
      return `${where} (${describeFrame(content.frame)})`;
    case "picture":
      return `${content.picture.name}, from ${where}`;
    case "contents":
      return `${cause === "replaced" ? "Replaced in" : "Cleared from"} ${where}: ${contentsLabel(content.frame)}`;
    case "frames":
      return `${cause === "replaced" ? "Replaced inputs" : "Cleared inputs"} (${plural(content.frames.length, "input", "inputs")})`;
  }
}

/** A library entry as the trash names it: '"Portrait", from the library (set, 3 inputs)'. */
export function entryTrashTitle(entry: Pick<StoredEntry, "name" | "kind" | "inputs">): string {
  const { frames } = entry.inputs;
  const what =
    entry.kind === "set"
      ? `set, ${plural(frames.length, "input", "inputs")}`
      : `${frames[0] ? frameRoleLabel(frames[0]) : "empty"} frame`;
  return `"${entry.name}", from the library (${what})`;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function ago(ms: number): string {
  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h ago`;
  return `${plural(Math.floor(ms / DAY), "day", "days")} ago`;
}

/** "removed 3 h ago · 6 days left", or that it goes at the next start. */
export function trashAgeText(removedAt: number, expiresAt: number, now: number): string {
  const left = expiresAt - now;
  const when =
    left <= 0
      ? "goes at the next start"
      : left >= DAY
        ? `${plural(Math.floor(left / DAY), "day", "days")} left`
        : `${plural(Math.max(1, Math.floor(left / HOUR)), "hour", "hours")} left`;
  return `removed ${ago(now - removedAt)} · ${when}`;
}

export const TRASH_EMPTY_LABEL = "Empty the trash";
export const RESTORE_FROM_TRASH = "Restore";
export const DELETE_NOW = "Delete now";
export const NO_LONGER_IN_TRASH = "No longer in the trash";
export const NEWER_REMOVAL = "Removed by a newer version of Enso";
export const DELETE_FROM_TRASH_FAILED = "Could not delete from the trash";

/** "Deleted from the trash", or "The trash is emptied" for several. */
export function deletedFromTrashText(count: number): string {
  return count === 1 ? "Deleted from the trash" : "The trash is emptied";
}

/** "Nothing in the trash. Removed inputs stay here for 7 days." */
export function trashEmptyText(days: number): string {
  return `Nothing in the trash. Removed inputs stay here ${keptForText(days)}.`;
}

/** "about 85 MB": a size for people. */
export function aboutSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `about ${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `about ${Math.round(bytes / (1024 * 1024))} MB`;
  return `about ${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** "12 removed inputs and 2 saved entries": what the trash holds. */
export function trashCountText(removals: number, entries: number): string {
  const parts: string[] = [];
  if (removals > 0) parts.push(plural(removals, "removed input", "removed inputs"));
  if (entries > 0) parts.push(plural(entries, "saved entry", "saved entries"));
  return parts.join(" and ") || "nothing";
}

/** What Empty asks before it deletes. */
export function emptyTrashText(removals: number, entries: number, bytes: number | null): string {
  const size = bytes === null ? "" : aboutSize(bytes);
  const freed = size ? ` ${size.charAt(0).toUpperCase()}${size.slice(1)} is freed.` : "";
  return `Delete ${trashCountText(removals, entries)} now?${freed} They cannot be brought back.`;
}

/** After deleting from the trash: the space freed, or when it will be. */
export function reclaimedText(freed: number | null): string {
  return freed === null
    ? "The space is freed once Enso runs in one tab: close the other Enso tabs, then reload this one."
    : freed > 0
      ? `${aboutSize(freed)} freed`
      : "No space freed: the pictures are still used elsewhere";
}

/** '"Portrait" is back in the library', with what that pushed out. */
export function untrashedText(name: string): string {
  return `"${name}" is back in the library`;
}

export const PINS_FULL_ON_RESTORE = "It came back unpinned: the pins are full";

/** "Keep removed inputs for": the settings row and its lines. */
export const TRASH_DAYS_LABEL = "Keep removed inputs for";

export function trashDaysValue(days: number): string {
  return plural(days, "day", "days");
}

/** The settings row's line: what the trash keeps, or what a shorter time drops. */
export function trashDaysText(going: number): string {
  return going > 0
    ? `${plural(going, "removed input goes", "removed inputs go")} at the next start`
    : "Removed inputs stay in the trash this long";
}

export const RESTORED_FROM_TRASH = "Restored from the trash";

/** "One picture could not be read back": a restore from the trash lost bytes. */
export function lostRestoredPicturesText(n: number): string {
  return n === 1 ? "One picture could not be read back" : `${n} pictures could not be read back`;
}

export const NOT_KEPT_IN_TRASH = "Not kept in the trash: storage is full";
export const STORAGE_FULL = "Storage is full.";
export const FULL_WITH_OTHER_TABS =
  "Storage is full. Close the other Enso tabs, then delete again.";
