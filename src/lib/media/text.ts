// The words of the media store's client side, in one place: uploads, their
// refusals and the ages and sizes every list shows.

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
  return `about ${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
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
