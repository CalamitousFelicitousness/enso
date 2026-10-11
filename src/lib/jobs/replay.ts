// What sending a recorded job again needs: the server holds its uploads under
// their hashes, and an upload it no longer holds is made again from its source
// over the frames the record kept. The uploads themselves happen in
// src/inputs/materialise.ts.

import type { StoredFrame, StoredJob } from "@/lib/inputs/stored";
import type { JobDomain } from "./domains";
import { replayMissingText, type ReplayMissing } from "./text";

/** A picture a job sent is no longer stored, so the job cannot be sent again as it was. */
export class ReplayError extends Error {
  override name = "ReplayError";
  readonly missing: ReplayMissing;
  constructor(missing: ReplayMissing) {
    super(replayMissingText(missing));
    this.missing = missing;
  }
}

/** The server pins and resolves any string that starts with this, at any depth. */
export const UPLOAD_PREFIX = "upload:";

export function isUploadRef(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(UPLOAD_PREFIX);
}

/** Every upload ref a request names, however deep, in the order met, once each. */
export function refsIn(value: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown): void => {
    if (isUploadRef(v)) found.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === "object" && v !== null) Object.values(v).forEach(walk);
  };
  walk(value);
  return [...found];
}

/** A deep copy of the request with every string the mapping names replaced. */
export function substituteRefs<T>(value: T, mapping: ReadonlyMap<string, string>): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return mapping.get(v) ?? v;
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v === "object" && v !== null) {
      return Object.fromEntries(Object.entries(v).map(([key, x]) => [key, walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}

/** Why a job is not sent again from its card, or how: `remake` when some of
 * its uploads are made again from the saved inputs (it still runs), `gone`
 * when a job without inputs sent a file the server lost. Process now jobs
 * go again through Process now. */
export type ReplayProblemCode = "processNow" | "remake" | "gone";

/** What a record's facts say about sending its job again; null when the
 * server holds every upload it names. */
export function replayProblem(facts: {
  domain: JobDomain;
  missingRefs: number;
  hasInputs: boolean;
}): ReplayProblemCode | null {
  if (facts.domain === "preprocess") return "processNow";
  if (facts.missingRefs === 0) return null;
  return facts.hasInputs ? "remake" : "gone";
}

/** The color LUT a request sends: an image job's or a Process job's. */
function lutRefOf(request: Record<string, unknown>): unknown {
  const grading = request["grading"];
  return typeof grading === "object" && grading !== null
    ? (grading as Record<string, unknown>)["lut_cube_file"]
    : request["grading_lut_file"];
}

/** What a job sent that the server no longer holds and that cannot be made
 * again: an upload with no source (the color LUT, or a file sent as it
 * was), or one whose source reads a frame the record lacks or a picture
 * whose bytes are neither here nor on the server (`unheld`). Null when every
 * one can be made again. */
export function replayGone(
  job: Pick<StoredJob, "request" | "refs" | "inputs" | "maps">,
  missingRefs: readonly string[],
  unheld: (cid: string) => boolean,
): ReplayMissing | null {
  const lut = lutRefOf(job.request);
  for (const ref of missingRefs) {
    const source = job.refs[ref];
    if (!source) return ref === lut ? "lut" : "file";
    const gone = replayNeeds({ refs: { [ref]: source }, inputs: job.inputs, maps: job.maps }).find(
      (need) => need.cid.startsWith("missing:") || unheld(need.cid),
    );
    if (gone) return gone.what;
  }
  return null;
}

export interface NeededBytes {
  cid: string;
  what: ReplayMissing;
}

/** The bytes sending a record again reads: the pictures each composite draws
 * and each file is, the mask objects and region masks it sends, and the maps
 * it sent as pictures. A frame or picture the record does not hold needs a
 * cid that cannot be there. */
export function replayNeeds(job: Pick<StoredJob, "refs" | "inputs" | "maps">): NeededBytes[] {
  const frames = job.inputs?.frames ?? [];
  const frame = (id: string): StoredFrame | undefined => frames.find((f) => f.id === id);
  const needs = new Map<string, ReplayMissing>();
  const need = (cid: string | undefined, what: ReplayMissing) => {
    needs.set(cid ?? `missing:${what}`, what);
  };
  for (const source of Object.values(job.refs)) {
    switch (source.kind) {
      case "composite": {
        const pictures = frame(source.frameId)?.pictures.filter((p) => p.visible && p.transform);
        if (!pictures) need(undefined, "picture");
        for (const p of pictures ?? []) need(p.cid, "picture");
        break;
      }
      case "file":
        need(
          frame(source.frameId)?.pictures.find((p) => p.id === source.pictureId)?.cid,
          "picture",
        );
        break;
      case "mask": {
        const objects = frame(source.frameId)?.mask.objects;
        if (!objects) need(undefined, "mask");
        for (const o of objects ?? []) need(o.cid, "mask");
        break;
      }
      case "ipMask":
        need(
          frame(source.frameId)?.ipAdapter.masks.find((m) => m.id === source.maskId)?.cid,
          "mask",
        );
        break;
      case "map":
        need(job.maps[source.key], "map");
        break;
    }
  }
  return [...needs].map(([cid, what]) => ({ cid, what }));
}
