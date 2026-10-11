// A color LUT is named by a pair in the settings, its file's name and the
// hash of its bytes once the server holds them; the bytes themselves wait in
// the browser. A build sends the hash first, and bytes go with it only when
// they are the pair's own: known to have its hash, or, before it has one, a
// pick under its name. No LUT goes out under another's name or hash.

import { UPLOAD_PREFIX } from "@/lib/jobs/replay";
import { isHash } from "@/lib/media/hash";
import { LUT_EARLIER, lutGoneText } from "@/lib/media/text";

/** Where a LUT is picked: the Images view's Color tab or the Process view's Color Grading. */
export type LutPlace = "images" | "process";

/** A LUT a build cannot send: neither its bytes nor the server's copy are left. */
export class LutRefused extends Error {
  override name = "LutRefused";
  readonly where: LutPlace;
  constructor(where: LutPlace, lutName: string) {
    super(lutGoneText(lutName, where));
    this.where = where;
  }
}

export interface LutPair {
  /** The file's name; empty for no LUT. */
  name: string;
  /** The hash of its bytes, once the server holds them. */
  hash: string | null;
}

/** A LUT's bytes kept in the browser, with the name they were picked under
 * and their hash once the server answered for them. */
export interface PendingLut {
  name: string;
  file: Blob;
  hash?: string;
}

export const NO_LUT: LutPair = { name: "", hash: null };

/** Each view's pending LUT bytes, as their record keeps them. */
export interface PendingLuts {
  images: PendingLut | null;
  process: PendingLut | null;
}

/** The pending bytes of a record stored at `version`; version 1 kept the
 * Color tab's file alone. */
export function migratePendingLuts(persisted: unknown, version: number): PendingLuts {
  if (version >= 2) return persisted as PendingLuts;
  const file = (persisted as { file?: File | null } | null)?.file ?? null;
  return { images: file ? { name: file.name, file } : null, process: null };
}

/** How a build sends a LUT: by its hash, with its bytes when they are here. */
export type LutStaging =
  | { kind: "none" }
  | { kind: "stage"; hash: string | null; bytes: Blob | null }
  | { kind: "pickAgain" };

/** The pair's bytes when they are here: once the pair names a hash, only
 * bytes known to have it, whatever their name; before that, a pick's bytes
 * under the pair's name. */
export function lutBytes(pair: LutPair, pending: PendingLut | null): Blob | null {
  if (!pending || !pair.name) return null;
  if (pair.hash) return pending.hash === pair.hash ? pending.file : null;
  return pending.hash === undefined && pending.name === pair.name ? pending.file : null;
}

export function stageLut(pair: LutPair, pending: PendingLut | null): LutStaging {
  if (!pair.name) return { kind: "none" };
  const bytes = lutBytes(pair, pending);
  if (pair.hash) return { kind: "stage", hash: pair.hash, bytes };
  return bytes ? { kind: "stage", hash: null, bytes } : { kind: "pickAgain" };
}

/** What the server said of a LUT's hash when its section asked; failed when
 * it could not be asked. */
export type LutClaim = "unchecked" | "present" | "missing" | "failed";

export type LutState =
  | { kind: "none" }
  | { kind: "ready"; name: string }
  /** The server is asked whether it still holds the bytes. */
  | { kind: "checking"; name: string }
  /** The server holds the bytes; they are on their way back here. */
  | { kind: "held"; name: string }
  /** The server could not be asked; sending the LUT asks again. */
  | { kind: "unverified"; name: string }
  | { kind: "pickAgain"; name: string };

export function lutState(pair: LutPair, pending: PendingLut | null, claim: LutClaim): LutState {
  if (!pair.name) return { kind: "none" };
  if (lutBytes(pair, pending)) return { kind: "ready", name: pair.name };
  if (!pair.hash || claim === "missing") return { kind: "pickAgain", name: pair.name };
  if (claim === "present") return { kind: "held", name: pair.name };
  if (claim === "failed") return { kind: "unverified", name: pair.name };
  return { kind: "checking", name: pair.name };
}

/** The pair and its bytes once the server answered `hash` for the bytes
 * staged as `staged`; null when nothing changes, or when another pick or a
 * restore moved the pair on. */
export function acceptHash(
  pair: LutPair,
  pending: PendingLut | null,
  staged: PendingLut,
  hash: string,
): { pair: LutPair; pending: PendingLut } | null {
  if (!pending || pending.file !== staged.file || lutBytes(pair, pending) !== staged.file) {
    return null;
  }
  if (pair.hash === hash && pending.hash === hash) return null;
  return { pair: { name: pair.name, hash }, pending: { ...pending, hash } };
}

/** The hash an upload ref names; null for anything else, a ref from before the store included. */
export function refHash(ref: unknown): string | null {
  if (typeof ref !== "string" || !ref.startsWith(UPLOAD_PREFIX)) return null;
  const id = ref.slice(UPLOAD_PREFIX.length);
  return isHash(id) ? id : null;
}

/** The pair an older build's setting stands for: a bare upload ref, which
 * names no file, so the server's copy is the only one there is. */
export function legacyLutPair(ref: unknown): LutPair | null {
  if (typeof ref !== "string" || ref === "") return null;
  return { name: LUT_EARLIER, hash: refHash(ref) };
}

/** Whether a Process job sent a LUT its result does not name: sdnext applies
 * none when the bytes are gone, and says nothing. */
export function lutDropped(request: unknown, info: string | null): boolean {
  // a run that processed no image says nothing of any setting
  if (!info) return false;
  const grading = (request as { grading?: { lut_cube_file?: unknown } } | null | undefined)
    ?.grading;
  const sent = typeof grading?.lut_cube_file === "string" && grading.lut_cube_file !== "";
  return sent && !info.includes("Grading lut cube file");
}
