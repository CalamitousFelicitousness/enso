// The library's rules: how many entries it keeps, the order it lists them
// in, and what a new entry is called.

import { planTrim } from "@/lib/trim";
import type { EntryKind, StoredEntry, StoredPicture } from "./stored";
import { frameRoleLabel, positionLabel } from "./text";
import { isComposed, type Frame } from "./types";

/** Unpinned entries the library keeps; past it, the least recently used goes to the trash. */
export const LIBRARY_CAP = 100;
/** Entries that may be pinned, kept above the cap. */
export const MAX_PINNED_ENTRIES = 20;

/** What eviction and the order of the list go by. */
export type EntryFacts = Pick<StoredEntry, "id" | "pinned" | "usedAt" | "savedAt" | "trashedAt">;

const NONE: ReadonlySet<string> = new Set();

/** Most recently used first; the later saved first when used at the same time. */
export function byUse(a: EntryFacts, b: EntryFacts): number {
  return b.usedAt - a.usedAt || b.savedAt - a.savedAt || a.id.localeCompare(b.id);
}

/** The library's order: pinned entries first, then by use, so the next to leave is last. */
export function listOrder(a: EntryFacts, b: EntryFacts): number {
  return Number(b.pinned) - Number(a.pinned) || byUse(a, b);
}

/** The entries in the library and not pinned, which the cap counts. */
export function unpinned<T extends EntryFacts>(entries: Iterable<T>): T[] {
  return [...entries].filter((e) => e.trashedAt === null && !e.pinned);
}

/** The pinned entries in the library. */
export function pinned<T extends EntryFacts>(entries: Iterable<T>): T[] {
  return [...entries].filter((e) => e.trashedAt === null && e.pinned);
}

/** The ids of the unpinned entries past the cap, least recently used first. */
export function overCap(entries: Iterable<EntryFacts>): string[] {
  return planTrim(unpinned(entries), LIBRARY_CAP, NONE, byUse);
}

/** "2026-10-08 14:05" in the time zone given. */
function stamp(now: number, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return `${parts["year"]}-${parts["month"]}-${parts["day"]} ${parts["hour"]}:${parts["minute"]}`;
}

/** What a new entry is called: a frame after its first picture without the
 * extension, else by its place and role ("Input 2 (Reference)"); a set after
 * when it was saved ("Inputs 2026-10-08 14:05"). */
export function defaultEntryName(
  kind: EntryKind,
  first: Pick<Frame, "role" | "control"> & { pictures: readonly { name: string }[] },
  position: number,
  now: number,
  timeZone: string,
): string {
  if (kind === "set") return `Inputs ${stamp(now, timeZone)}`;
  const named = first.pictures[0]?.name.replace(/\.[^.]+$/, "").trim();
  return named || `${positionLabel(position)} (${frameRoleLabel(first)})`;
}

/** The pictures a card shows for an entry, at most four, and how many more
 * there are: a composed frame's base picture, a set frame's pictures, or the
 * first picture of each frame of a set. */
export function entryThumbs(entry: Pick<StoredEntry, "kind" | "inputs">): {
  pictures: StoredPicture[];
  more: number;
} {
  const { frames } = entry.inputs;
  const shown =
    entry.kind === "set"
      ? frames.flatMap((f) => f.pictures.slice(0, 1))
      : (frames[0]?.pictures ?? []);
  const limit = entry.kind === "frame" && frames[0] && isComposed(frames[0].role) ? 1 : 4;
  return { pictures: shown.slice(0, limit), more: Math.max(0, shown.length - limit) };
}
