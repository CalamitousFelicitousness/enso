// The reset's own record in localStorage: asked for, running, or done and
// not yet told. The page that asks writes it; the next page start acts on it.

import { RESET_ROWS, type ResetRow } from "./manifest";

/** What did not go as asked, as the notice after says it. */
export type ResetNote =
  /** The server could not be asked to end the sign-in. */
  | "session"
  /** A database was still held open; it may not have been deleted. */
  | "blocked"
  /** enso-inputs holds a store of a newer build and was left as it was. */
  | "newer";

const NOTES: readonly ResetNote[] = ["session", "blocked", "newer"];

export type ResetRecord =
  | { state: "pending"; rows: ResetRow[]; notes: ResetNote[]; at: number }
  | { state: "running"; rows: ResetRow[]; notes: ResetNote[]; at: number }
  | { state: "done"; rows: ResetRow[]; notes: ResetNote[]; at: number; postponed: boolean };

/** A running reset this old is taken over: the page that ran it is gone. */
export const STALE_MS = 60_000;

export function isStale(record: ResetRecord, now: number): boolean {
  return now - record.at > STALE_MS;
}

/** The record as stored; null for none or one this build cannot read. */
export function readResetRecord(raw: string | null): ResetRecord | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { state, rows, notes, at, postponed } = value as Record<string, unknown>;
  if (state !== "pending" && state !== "running" && state !== "done") return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  if (!Array.isArray(rows) || !rows.every((r) => RESET_ROWS.includes(r as ResetRow))) return null;
  if (!Array.isArray(notes) || !notes.every((n) => NOTES.includes(n as ResetNote))) return null;
  const base = { rows: rows as ResetRow[], notes: notes as ResetNote[], at };
  if (state === "done") return { state, ...base, postponed: postponed === true };
  return { state, ...base };
}

export function writeResetRecord(record: ResetRecord): string {
  return JSON.stringify(record);
}
