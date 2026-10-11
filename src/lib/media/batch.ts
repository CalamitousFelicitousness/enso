// What one upload batch sends, decided from the server's answer to its claim:
// the bytes the server holds go as they are, the rest upload, and the room the
// server has left decides before any byte goes. Pictures kept only for a job's
// record give way when room is short; the request's own never do.

/** One item of a batch, as its plan sees it. */
export interface PlanItem {
  id: string;
  /** A hash remembered or given for the item's bytes; null when none is known. */
  hash: string | null;
  /** The item's size in bytes, when known before its bytes are made. */
  size: number | null;
  /** Kept with a job's record only: left out rather than failing the batch. */
  record: boolean;
}

/** The server's answer to a claim. */
export interface ClaimAnswer {
  present: readonly string[];
  missing: readonly string[];
  lost: readonly string[];
  space: { free: number; needed: number };
}

export interface BatchPlan {
  /** The items whose bytes the server holds, with their hash. */
  held: Map<string, string>;
  /** The items to upload: the request's first, then the record's, smallest first. */
  upload: string[];
  /** Record-only items the server has no room for. */
  leftOut: string[];
  /** The request's items need more room than the server has; nothing is sent. */
  refused: { room: number; needed: number } | null;
}

/** The bytes a claim announces: what the items with no known hash will send. */
export function claimBytes(items: readonly PlanItem[]): number {
  return items.reduce((sum, item) => sum + (item.hash === null ? (item.size ?? 0) : 0), 0);
}

/** The bytes the server can take for this batch. `needed` is the claimed
 * bytes plus the server's reserve and the uploads in flight. */
export function roomOf(space: ClaimAnswer["space"], claimed: number): number {
  return Math.max(0, space.free - (space.needed - claimed));
}

export function planBatch(
  items: readonly PlanItem[],
  answer: ClaimAnswer,
  claimed: number,
): BatchPlan {
  const present = new Set(answer.present);
  const held = new Map<string, string>();
  const send: PlanItem[] = [];
  for (const item of items) {
    if (item.hash !== null && present.has(item.hash)) held.set(item.id, item.hash);
    else send.push(item);
  }
  const room = roomOf(answer.space, claimed);
  const request = send.filter((item) => !item.record);
  const needed = request.reduce((sum, item) => sum + (item.size ?? 0), 0);
  if (needed > room) return { held, upload: [], leftOut: [], refused: { room, needed } };
  let left = room - needed;
  const upload = request.map((item) => item.id);
  const leftOut: string[] = [];
  const record = send.filter((item) => item.record).sort((a, b) => (a.size ?? 0) - (b.size ?? 0));
  for (const item of record) {
    const size = item.size ?? 0;
    if (size <= left) {
      upload.push(item.id);
      left -= size;
    } else {
      leftOut.push(item.id);
    }
  }
  return { held, upload, leftOut, refused: null };
}

/** How far a batch has got: bytes over the upload set, and files done. */
export interface BatchProgress {
  phase: "claiming" | "uploading" | "storing";
  sent: number;
  total: number;
  done: number;
  files: number;
}

/** One upload's part of a batch's progress. */
export interface UploadShare {
  sent: number;
  total: number;
  done: boolean;
}

/** The batch's progress from its uploads: storing once every byte is sent,
 * while the server hashes and writes them and until the action moves on. */
export function progressOf(shares: Iterable<UploadShare>): BatchProgress {
  let sent = 0;
  let total = 0;
  let done = 0;
  let files = 0;
  for (const share of shares) {
    files += 1;
    total += share.total;
    sent += share.done ? share.total : Math.min(share.sent, share.total);
    if (share.done) done += 1;
  }
  const phase = total > 0 && sent >= total ? "storing" : "uploading";
  return { phase, sent, total, done, files };
}
