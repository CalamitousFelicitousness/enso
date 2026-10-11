// The words of the media store's client side, in one place: uploads, their
// refusals and the ages and sizes every list shows.

import type { SkipReason } from "./migration";

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 min ago", "3 h ago", "2 days ago": how long ago something
 * happened, for every list that dates its rows. */
export function ageText(ms: number): string {
  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h ago`;
  return `${plural(Math.floor(ms / DAY), "day", "days")} ago`;
}

/** "about 85 MB": a size for people. */
export function aboutSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `about ${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `about ${Math.round(bytes / (1024 * 1024))} MB`;
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb < 10) return `about ${gb.toFixed(1)} GB`;
  if (gb < 1024) return `about ${Math.round(gb)} GB`;
  return `about ${(gb / 1024).toFixed(1)} TB`;
}

/** Why an upload did not land. */
export type UploadFailure =
  /** The server cannot take the bytes: `room` is what it can still store, `needed` what they take. */
  | { kind: "space"; room: number; needed: number }
  /** The server's disk is full and it gave no numbers. */
  | { kind: "full" }
  | { kind: "stalled" }
  | { kind: "network" }
  | { kind: "busy" }
  /** A file the browser can no longer read, such as one moved or changed on disk. */
  | { kind: "unreadable"; name: string }
  /** The media store is off; the server's message says why. */
  | { kind: "storeOff"; message: string }
  | { kind: "server"; message: string };

export function uploadFailureText(failure: UploadFailure): string {
  switch (failure.kind) {
    case "space":
      return `Not enough space on the server: this needs ${aboutSize(failure.needed)} and it can take ${aboutSize(failure.room)}`;
    case "full":
      return "The server's disk is full";
    case "stalled":
      return "The upload stalled; check the connection and try again";
    case "network":
      return "The server could not be reached";
    case "busy":
      return "The server is busy; try again in a minute";
    case "unreadable":
      return `${failure.name} can no longer be read; add it again`;
    case "storeOff":
    case "server":
      return failure.message;
  }
}

/** What the Generate button says while its job is on the way. */
export const PREPARING = "Preparing";
export const STORING = "Storing";
export const SENDING = "Sending";

export function uploadingText(percent: number): string {
  return `Uploading ${percent}%`;
}

export const STOP_UPLOAD = "Stop the upload";
export const NO_SKIP = "No generation to skip";
export const UPLOAD_CANCELLED = "Upload cancelled, the job was not sent";
export const SUBMIT_FAILED = "Could not send the job";
export const RETRY = "Retry";
export const CANCEL = "Cancel";

/** "Uploading 2 of 3 files, about 120 MB of 480 MB": a batch still on its way. */
export function batchText(done: number, files: number, sent: number, total: number): string {
  const size = total > 0 ? `, ${aboutSize(sent)} of ${aboutSize(total).replace("about ", "")}` : "";
  return `Uploading ${done} of ${plural(files, "file", "files")}${size}`;
}

/** "Fetching 2 of 4 pictures, about 120 MB": bytes on their way from the server. */
export function fetchingText(done: number, total: number, bytes: number): string {
  const size = bytes > 0 ? `, ${aboutSize(bytes)}` : "";
  return `Fetching ${done} of ${plural(total, "picture", "pictures")}${size}`;
}

export const RESTORE_CANCELLED = "Restore cancelled";

/** Pictures kept only with a job's record that the server had no room for. */
export function keptOutText(count: number, room: number): string {
  const what = count === 1 ? "1 picture was" : `${count} pictures were`;
  return `${what} not kept with the job: the server can take ${aboutSize(room)} more`;
}

/** Why a job and its record were not sent. */
export type SubmitFailure =
  | { kind: "full" }
  | { kind: "busy" }
  | { kind: "tooLarge" }
  | { kind: "removed" }
  | { kind: "stillMissing"; names: readonly string[] }
  | { kind: "server"; message: string };

export function submitFailureText(failure: SubmitFailure): string {
  switch (failure.kind) {
    case "full":
      return "The server's disk is full";
    case "busy":
      return "The server is busy; try again in a minute";
    case "tooLarge":
      return "The request is too large for the server; a mask with very many strokes can cause it";
    case "removed":
      return "This job was queued before and has since been removed";
    case "stillMissing": {
      const [first, ...rest] = failure.names;
      const more = rest.length > 0 ? ` and ${rest.length} more` : "";
      return `The server does not hold ${first ?? "a picture"}${more} after a second try`;
    }
    case "server":
      return failure.message;
  }
}

/** A server from before the media store: nothing can be uploaded to it. */
export const OLDER_SERVER = "This server has no media store (older Enso)";
export const STORE_OFF = "The media store is off";

const capitalised = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

// The library and its trash on the server

/** "Media store off: the folder is not writable": the reason the server gave. */
export function storeOffText(reason: string | null): string {
  return reason ? `Media store off: ${reason}` : STORE_OFF;
}

export const LIBRARY_READ_FAILED = "Could not read the library";
export const LOADING = "Loading";
export const NOT_MOVED_HEADING = "In this browser, not moved yet";
export const MOVE_FIRST = "Move it to the server first";
export const DELETE_FOR_EVERYONE = "Delete for everyone";
export const SAVING = "Saving to the library";

/** "38 saved entries and 120 job records", or one of them. */
function heldText(entries: number, records: number): string {
  return [
    entries > 0 ? plural(entries, "saved entry", "saved entries") : null,
    records > 0 ? plural(records, "job record", "job records") : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" and ");
}

/** "3 saved entries and 120 job records in this browser, not moved yet". */
export function notMovedText(entries: number, records = 0): string {
  return `${heldText(entries, records)} in this browser, not moved yet`;
}

/** '"Portrait" is in the trash; restore it first'. */
export function inTrashText(name: string): string {
  return `"${name}" is in the trash; restore it first`;
}

/** "It came back unpinned: 20 entries are pinned". */
export function unpinnedText(max: number): string {
  return `It came back unpinned: ${max} entries are pinned`;
}

/** Asked before deleting an entry another user removed. */
export function deleteForEveryoneText(name: string, by: string): string {
  return `Delete "${name}" for everyone? ${by} removed it. It cannot be brought back.`;
}

/** The size a list's part of the trash frees, or nothing while unmeasured. */
const sizePart = (bytes: number | null, where: string) =>
  bytes === null ? null : `${aboutSize(bytes)} ${where}`;

/** "12 removed inputs here · 2 saved entries on the server · about 85 MB
 * here, about 1.2 GB on the server": what the trash holds and frees. */
export function trashHeaderText(
  removals: number,
  entries: number,
  here: number | null,
  server: number | null,
): string {
  const parts: string[] = [];
  if (removals > 0) parts.push(`${plural(removals, "removed input", "removed inputs")} here`);
  if (entries > 0) parts.push(`${plural(entries, "saved entry", "saved entries")} on the server`);
  const sizes = [
    removals > 0 ? sizePart(here, "here") : null,
    entries > 0 ? sizePart(server, "on the server") : null,
  ].filter((s): s is string => s !== null);
  if (sizes.length > 0) parts.push(sizes.join(", "));
  return parts.join(" · ");
}

/** The entries other users removed, for the Empty dialog. */
export interface RemovedByOthers {
  count: number;
  /** Their one name, when one user removed them all. */
  name: string | null;
}

/** What Empty asks before it deletes the listed removals here and the
 * listed entries for everyone. */
export function emptyBothText(
  removals: number,
  entries: number,
  others: RemovedByOthers,
  here: number | null,
  server: number | null,
): string {
  const parts: string[] = [];
  if (removals > 0) {
    parts.push(`${plural(removals, "removed input", "removed inputs")} from this browser`);
  }
  if (entries > 0) {
    const whose =
      others.count === 0
        ? ""
        : others.name
          ? ` (${others.count === 1 ? "one" : others.count} removed by ${others.name})`
          : ` (${others.count} removed by others)`;
    parts.push(`${plural(entries, "saved entry", "saved entries")}${whose} for everyone`);
  }
  const sizes = [
    removals > 0 ? sizePart(here, "here") : null,
    entries > 0 ? sizePart(server, "on the server") : null,
  ].filter((s): s is string => s !== null);
  const freed = sizes.length > 0 ? ` ${capitalised(sizes.join(" and "))} are freed.` : "";
  return `Delete ${parts.join(" and ")}?${freed} They cannot be brought back.`;
}

/** After deleting from the trash on the server: what it freed, and that the
 * rest goes within the week when some was kept for a save in progress. */
export function serverFreedText(freed: number, reclaimable: number | null): string {
  if (freed === 0) {
    return reclaimable
      ? "No space freed on the server yet; it goes within the week"
      : "No space freed on the server yet";
  }
  const rest = reclaimable !== null && freed < reclaimable ? "; the rest goes within the week" : "";
  return `${aboutSize(freed)} freed on the server${rest}`;
}

// The settings the server keeps for every browser

export const LIBRARY_CAP_LABEL = "Saved entries kept";
export const RECORD_CAP_LABEL = "Job records kept per browser";
export const STORE_ROW_LABEL = "Media store";
export const SETTING_FAILED = "Could not change the setting";
export const SETTINGS_FROZEN = "Settings are frozen on this server";

/** The retention row's line: what a shorter time lets go, here and on the server. */
export function trashDaysBothText(here: number, server: number): string {
  if (here === 0 && server === 0) return "Removed inputs stay in the trash this long";
  const local = `${plural(here, "removed input in this browser goes", "removed inputs in this browser go")} at the next start`;
  if (server === 0) return local;
  if (here === 0) {
    return `${plural(server, "saved entry in the trash goes", "saved entries in the trash go")} within 5 minutes`;
  }
  return `${local}, ${plural(server, "saved entry", "saved entries")} within 5 minutes`;
}

/** The library cap row's line. */
export function libraryCapText(moving: number): string {
  return moving > 0
    ? `${plural(moving, "saved entry moves", "saved entries move")} to the trash within 5 minutes`
    : "Past this, the least recently used entries move to the trash";
}

/** The record cap row's line. */
export function recordCapText(mine: number): string {
  return mine > 0
    ? `${plural(mine, "of this browser's job records is", "of this browser's job records are")} deleted within 5 minutes`
    : "Each browser keeps this many job records on the server";
}

/** A reduction the server applies for every browser, asked before it is sent. */
export function reductionText(
  setting: "trash_days" | "library_cap" | "record_cap",
  value: number,
  counts: { here: number; server: number },
): { title: string; description: string } {
  switch (setting) {
    case "trash_days":
      return {
        title: `Keep removed inputs for ${plural(value, "day", "days")}?`,
        description: `${capitalised(trashDaysBothText(counts.here, counts.server))}, for every browser. They cannot be brought back.`,
      };
    case "library_cap":
      return {
        title: `Keep ${plural(value, "saved entry", "saved entries")}?`,
        description: `${capitalised(libraryCapText(counts.server))}, for every browser.`,
      };
    case "record_cap":
      return {
        title: `Keep ${plural(value, "job record", "job records")} per browser?`,
        description:
          counts.here > 0
            ? `${plural(counts.here, "of this browser's job records is", "of this browser's job records are")} deleted within 5 minutes, and other browsers' records past ${value} too. Their results lose Restore inputs and Run again. They cannot be brought back.`
            : `Every browser's job records past ${value} are deleted within 5 minutes. Their results lose Restore inputs and Run again. They cannot be brought back.`,
      };
  }
}

/** The store row: where the store is and the space left, or why it is off. */
export function storeRowText(
  state: { enabled: boolean; reason: string | null; root: string | null },
  free: number | null,
  configured: string | null,
): string {
  if (!state.enabled) return `Off: ${state.reason ?? "the server keeps no media store"}`;
  const where = state.root ?? "";
  const space = free === null ? "" : ` · ${aboutSize(free)} free`;
  const pending =
    configured && configured !== state.root
      ? ` · set to ${configured}, applies after a restart`
      : "";
  return `${where}${space}${pending}`;
}

/** The first answer from a server that keeps removed inputs for less time
 * than this browser did. */
export function retentionNoticeText(
  server: number,
  local: number,
): { title: string; description: string; keep: string; use: string } {
  return {
    title: `This server keeps removed inputs for ${plural(server, "day", "days")}; this browser kept them for ${plural(local, "day", "days")}.`,
    description: `Removed inputs older than ${plural(server, "day", "days")} go at the next start.`,
    keep: `Keep ${plural(local, "day", "days")} on the server`,
    use: `Use ${plural(server, "day", "days")}`,
  };
}

/** The standing notice while the server keeps no uploads. */
export const STORE_OFF_DETAIL =
  "Uploads, the library and job records are unavailable until it is fixed and the server restarted.";
export const OLDER_SERVER_DETAIL = "Uploads, the library and job records are unavailable.";

// Moving this browser's older records to the server

export const MOVE = "Move";
export const NOT_NOW = "Not now";
export const MOVING_ELSEWHERE = "Moving in another tab";
export const DELETE_FROM_BROWSER = "Delete from this browser";
export const MOVE_CANCELLED = "Move cancelled";
export const MOVE_HERE = "Move here instead";

/** The offer: what moves, to which server and store, and the room there. */
export function moveOfferText(
  entries: number,
  records: number,
  where: { server: string; root: string | null },
  bytes: number,
  free: number | null,
): { title: string; description: string } {
  const at = where.root ? `${where.server} (${where.root})` : where.server;
  const room = free === null ? "" : `; ${aboutSize(free).replace("about ", "")} free there`;
  return {
    title: `Move ${heldText(entries, records)} to the server at ${at}?`,
    description: `${capitalised(aboutSize(bytes))}${room}.`,
  };
}

/** "Moving 12 of 158, about 340 MB of 1.2 GB". */
export function movingText(done: number, total: number, bytes: number, totalBytes: number): string {
  const size =
    totalBytes > 0 ? `, ${aboutSize(bytes)} of ${aboutSize(totalBytes).replace("about ", "")}` : "";
  return `Moving ${done} of ${total}${size}`;
}

/** After a move: what went, what arrived unpinned and what stayed. */
export function movedAllText(
  moved: { entries: number; records: number },
  unpinned: number,
  maxPins: number,
  skipped: number,
): { title: string; description: string | null } {
  const lines: string[] = [];
  if (unpinned > 0) {
    lines.push(
      `${plural(unpinned, "entry", "entries")} arrived unpinned: the server's ${maxPins} pins are taken`,
    );
  }
  if (skipped > 0) lines.push(`${skipped} skipped; they stay in this browser`);
  return {
    title:
      moved.entries + moved.records > 0
        ? `Moved ${heldText(moved.entries, moved.records)}`
        : "Nothing was moved",
    description: lines.length > 0 ? lines.join(". ") : null,
  };
}

/** Why a move stopped, and how far it got. */
export function moveStoppedText(
  status: number | null | "cancelled",
  moved: number,
): { title: string; description: string } {
  const so =
    moved > 0 ? `${moved} moved so far; the rest stay in this browser` : "Nothing was moved";
  if (status === "cancelled") return { title: MOVE_CANCELLED, description: so };
  const why =
    status === null
      ? "The server could not be reached"
      : status === 507
        ? "The server's disk is full"
        : status === 503
          ? "The media store is off"
          : status === 429
            ? "The server is busy; try again in a minute"
            : status === 408
              ? "The upload stalled"
              : `The server answered ${status}`;
  return { title: "The move stopped", description: `${why}. ${so}` };
}

/** Why an item stayed in this browser. */
export function skipText(reason: SkipReason): string {
  switch (reason.code) {
    case "idle":
      return "Older than 90 days: the server keeps a browser's job records for 90 days after its last job";
    case "full":
      return reason.kind === "entry"
        ? `The server's library is full (${reason.count} of ${reason.cap})`
        : `This browser has ${reason.count} of ${reason.cap} job records on the server`;
    case "refused":
      return reason.status === 413
        ? "Too large for the server"
        : `The server refused it: ${reason.reason}`;
  }
}

/** A move begun toward one server is not finished toward another. */
export function otherTargetText(from: string, to: string): string {
  return `The move started toward ${from}; this page is connected to ${to}`;
}

/** "120 job records": records a move left here, grouped by why. */
export function stayedRecordsText(count: number): string {
  return plural(count, "job record", "job records");
}

/** Asked before deleting what a move left here. */
export function deleteFromBrowserText(what: string, many: boolean): string {
  return many
    ? `Delete ${what} from this browser? They are not on the server, so they cannot be brought back.`
    : `Delete ${what} from this browser? It is not on the server, so it cannot be brought back.`;
}
