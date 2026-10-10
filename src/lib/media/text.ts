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
