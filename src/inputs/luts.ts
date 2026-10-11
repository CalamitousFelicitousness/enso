// The two color LUTs: a name-and-hash pair in each view's settings, and the
// bytes waiting in the browser until the server holds them. A build stages a
// LUT by its hash first; the hash comes back compare-and-set, so a pick or a
// restore during an upload never takes another file's hash. The pair and the
// bytes are two stores, written in the order that never shows a section a
// hash without its bytes, which would send a needless claim.

import { claim, blobUrl } from "@/api/blobs";
import { mediaFile } from "@/lib/mediaFiles";
import {
  acceptHash,
  LutRefused,
  NO_LUT,
  refHash,
  stageLut,
  type LutClaim,
  type LutPair,
  type LutPlace,
  type PendingLut,
} from "@/lib/lut";
import { useGenerationStore } from "@/stores/generationStore";
import { useLutStore } from "@/stores/lutStore";
import { useProcessLutStore } from "@/stores/processLutStore";
import { useProcessStore } from "@/stores/processStore";
import type { Bytes, UploadBatch } from "./uploads";

/** The pair a view's settings name. */
export function lutPairOf(where: LutPlace): LutPair {
  if (where === "images") {
    const { gradingLutFile, gradingLutHash } = useGenerationStore.getState();
    return { name: gradingLutFile, hash: gradingLutHash };
  }
  const { name, hash } = useProcessLutStore.getState();
  return { name, hash };
}

function setLutPair(where: LutPlace, pair: LutPair): void {
  if (where === "images") {
    useGenerationStore.setState({ gradingLutFile: pair.name, gradingLutHash: pair.hash });
  } else {
    useProcessLutStore.getState().set(pair);
    // an older build reads the bare ref here; it now names no LUT
    useProcessStore.getState().setSectionParam("grading", "lut_cube_file", "");
  }
}

/** A new pick: its bytes wait here, and the pair names it with no hash until the server answers. */
export function pickLut(where: LutPlace, file: File): void {
  setLutPair(where, { name: file.name, hash: null });
  useLutStore.getState().setPending(where, { name: file.name, file });
}

export function removeLut(where: LutPlace): void {
  setLutPair(where, NO_LUT);
  useLutStore.getState().setPending(where, null);
}

/** Write the hash the server answered for bytes staged as `staged` into the
 * pair and the bytes, unless the pair moved on. */
function acceptLutHash(where: LutPlace, staged: PendingLut, hash: string): void {
  const next = acceptHash(lutPairOf(where), useLutStore.getState()[where], staged, hash);
  if (!next) return;
  useLutStore.getState().setPending(where, next.pending);
  setLutPair(where, next.pair);
}

/** Forget a hash the server no longer holds, while the pair still names it.
 * Bytes here that have it stay, as a pick under the pair's name. */
function forgetHash(where: LutPlace, pair: LutPair): void {
  const now = lutPairOf(where);
  if (now.name !== pair.name || now.hash !== pair.hash) return;
  const pending = useLutStore.getState()[where];
  setLutPair(where, { ...now, hash: null });
  if (pending && pair.hash && pending.hash === pair.hash) {
    useLutStore.getState().setPending(where, { name: now.name, file: pending.file });
  }
}

/** Forget the hash a job's request sent its LUT under, once the server was
 * found without it, while the pair still names that hash. */
export function forgetLostLut(where: LutPlace, request: unknown): void {
  const grading = (request as { grading?: { lut_cube_file?: unknown } } | null | undefined)
    ?.grading;
  const hash = refHash(grading?.lut_cube_file);
  const pair = lutPairOf(where);
  if (hash && pair.hash === hash) forgetHash(where, pair);
}

/** Stage the LUT a view's settings name on `batch`; its ref, or null for none.
 * Throws LutRefused when neither its bytes nor its hash are known; a hash the
 * server lost, with no bytes here, refuses once the batch finds out. */
export function stageLutOn(batch: UploadBatch, where: LutPlace): string | null {
  const pair = lutPairOf(where);
  const pending = useLutStore.getState()[where];
  const plan = stageLut(pair, pending);
  if (plan.kind === "none") return null;
  if (plan.kind === "pickAgain") throw new LutRefused(where, pair.name);
  const staged = plan.bytes ? pending : null;
  const bytes: Bytes =
    plan.bytes ??
    (() => {
      forgetHash(where, pair);
      return Promise.reject(new LutRefused(where, pair.name));
    });
  return batch.stage(bytes, {
    name: pair.name,
    setting: true,
    ...(plan.hash ? { hash: plan.hash } : {}),
    onHash: (hashed) => {
      if (staged) acceptLutHash(where, staged, hashed.hash);
    },
  }).ref;
}

/** Settle a LUT named by a hash with no bytes here, telling `answer` what
 * the server said: held bytes then come back, a miss forgets the hash. */
export async function checkLut(
  where: LutPlace,
  pair: LutPair,
  answer: (claim: LutClaim) => void,
): Promise<void> {
  const url = pair.hash ? blobUrl(pair.hash) : null;
  if (!pair.hash || !url) {
    answer("missing");
    return;
  }
  try {
    const held = await claim([pair.hash], 0);
    if (!held.present.includes(pair.hash)) {
      forgetHash(where, pair);
      answer("missing");
      return;
    }
    answer("present");
    const file = await mediaFile(url, pair.name);
    const now = lutPairOf(where);
    if (now.name === pair.name && now.hash === pair.hash) {
      useLutStore.getState().setPending(where, { name: pair.name, file, hash: pair.hash });
    }
  } catch (err) {
    console.warn(`[luts] the ${where} LUT could not be checked`, err);
    answer("failed");
  }
}
