// What a job record needs before it can be sent again, and the request with
// fresh upload refs in the place of the ones it was sent with. The uploads
// themselves happen in src/inputs/materialise.ts.

import type { Source, StoredFrame, StoredJob } from "@/lib/inputs/stored";
import { isVideoDomain } from "./domains";
import type { ReplayMissing } from "./text";

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

export type ReplayProblemCode = "video" | "processNow" | "lutUpload" | "unrecordedUploads";

/** Sources whose bytes come from the job's frames. */
const FROM_FRAMES = new Set<Source["kind"]>(["composite", "file", "mask", "ipMask"]);

/** Why a record cannot be sent again, or null when every upload it names
 * can be made again from what it kept. */
export function replayProblem(
  job: Pick<StoredJob, "domain" | "request" | "refs" | "inputs" | "maps">,
): ReplayProblemCode | null {
  if (isVideoDomain(job.domain)) return "video";
  if (job.domain === "preprocess") return "processNow";
  for (const ref of refsIn(job.request)) {
    const source = job.refs[ref];
    if (!source) return job.request["grading_lut_file"] === ref ? "lutUpload" : "unrecordedUploads";
    if (FROM_FRAMES.has(source.kind) && !job.inputs) return "unrecordedUploads";
    if (source.kind === "map" && !(source.key in job.maps)) return "unrecordedUploads";
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
