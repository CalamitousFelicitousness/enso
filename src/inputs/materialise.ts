// The one way an image job's pictures leave the document. A builder asks the
// uploader for a picture by its source (a frame's pictures drawn at a size, a
// picture's file, a frame's mask, an IP-Adapter region mask, a map); the
// uploader makes the bytes, uploads them and records the source under the
// upload's ref. Sending a job again makes every picture again from the same
// sources over the frames its record kept.

import type { JobRequest } from "@/api/types/v2";
import { getInputLimits } from "@/lib/cloudLimits";
import { exportMask } from "@/lib/exportMask";
import { flattenCanvas } from "@/lib/flattenCanvas";
import { canonicalJson } from "@/lib/inputs/freshness";
import { optimizeImageForProvider } from "@/lib/imageOptimize";
import type { ProviderEncoding, Source, StoredJob } from "@/lib/inputs/stored";
import { composedPictures, type Frame, type Size } from "@/lib/inputs/types";
import { refsIn, substituteRefs } from "@/lib/jobs/replay";
import { replayMissingText, type ReplayMissing } from "@/lib/jobs/text";
import { resizeBlob } from "@/lib/resize";
import { currentJobRequest } from "@/lib/retiredJobFields";
import { uploadBlob } from "@/lib/upload";
import { currentMap, touchMap } from "./maps";

const MISSING: Record<ReplayMissing, string> = {
  picture: "A picture could not be read",
  mask: "A mask could not be read",
  map: "A map is no longer held",
};

/** A source's bytes are not there. */
class MissingBytes extends Error {
  override name = "MissingBytes";
  readonly missing: ReplayMissing;
  constructor(missing: ReplayMissing) {
    super(MISSING[missing]);
    this.missing = missing;
  }
}

/** A picture a job sent is no longer stored, so the job cannot be sent again as it was. */
export class ReplayError extends Error {
  override name = "ReplayError";
  readonly missing: ReplayMissing;
  constructor(missing: ReplayMissing) {
    super(replayMissingText(missing));
    this.missing = missing;
  }
}

/** What a job's uploads came from. */
export interface Ledger {
  /** The source of each upload, by ref. */
  refs: Record<string, Source>;
  /** The cid of each map sent as a picture, by key. */
  maps: Record<string, string>;
  /** Those maps' bytes, by cid. */
  blobs: Map<string, Blob>;
}

/** The frames pictures are made from, and the frame size their placements are in. */
export interface SourceFrames {
  frames: Frame[];
  size: Size;
}

/** A map's bytes kept with a job record, by key and cid. */
export interface HeldMaps {
  cids: Readonly<Record<string, string>>;
  blobs: ReadonlyMap<string, Blob>;
}

const NO_MAPS: HeldMaps = { cids: {}, blobs: new Map() };

export interface Upload {
  ref: string;
  /** The size the picture went out at. */
  size: Size;
}

interface Made {
  blob: Blob;
  name: string;
  size: Size;
  /** The map the bytes were made from, for the record. */
  map?: { cid: string; blob: Blob };
}

function frameOf(inputs: SourceFrames, frameId: string, missing: ReplayMissing): Frame {
  const frame = inputs.frames.find((f) => f.id === frameId);
  if (!frame) throw new MissingBytes(missing);
  return frame;
}

async function encoded(made: Made, encode: ProviderEncoding | null): Promise<Made> {
  if (!encode) return made;
  const limits = getInputLimits(encode.provider, encode.model);
  const optimized = await optimizeImageForProvider(made.blob, limits, encode.provider);
  return {
    ...made,
    blob: optimized.blob,
    name: `cloud-input.${optimized.format}`,
    size: optimized.dimensions,
  };
}

async function sizeOf(blob: Blob): Promise<Size> {
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

/** The bytes of a source, made from the frames; null for a mask with nothing painted. */
export async function materialise(
  source: Source,
  inputs: SourceFrames,
  held: HeldMaps = NO_MAPS,
): Promise<Made | null> {
  switch (source.kind) {
    case "composite": {
      const layers = composedPictures(frameOf(inputs, source.frameId, "picture"));
      if (layers.some((l) => !l.file)) throw new MissingBytes("picture");
      const flat = await flattenCanvas(
        layers,
        inputs.size.width,
        inputs.size.height,
        source.drawnAt,
      );
      if (!flat) throw new Error("A frame holds no picture to send");
      return encoded({ blob: flat, name: "input.png", size: source.drawnAt }, source.encode);
    }
    case "file": {
      const picture = frameOf(inputs, source.frameId, "picture").pictures.find(
        (p) => p.id === source.pictureId,
      );
      if (!picture?.file) throw new MissingBytes("picture");
      return {
        blob: picture.file,
        name: picture.name,
        size: { width: picture.width, height: picture.height },
      };
    }
    case "mask": {
      const { mask } = frameOf(inputs, source.frameId, "mask");
      const blob = await exportMask(
        mask.objects,
        mask.strokes,
        inputs.size.width,
        inputs.size.height,
      );
      if (!blob) return null;
      const { width, height } = source.drawnAt;
      const sized =
        width === inputs.size.width && height === inputs.size.height
          ? blob
          : await resizeBlob(blob, width, height);
      return { blob: sized, name: "mask.png", size: source.drawnAt };
    }
    case "ipMask": {
      const mask = frameOf(inputs, source.frameId, "mask").ipAdapter.masks.find(
        (m) => m.id === source.maskId,
      );
      if (!mask?.file) throw new MissingBytes("mask");
      return { blob: mask.file, name: mask.name, size: { width: mask.width, height: mask.height } };
    }
    case "map": {
      const cached = currentMap(source.key);
      const cid = held.cids[source.key];
      const stored = cid ? held.blobs.get(cid) : undefined;
      let map: { cid: string; blob: Blob };
      if (cached) {
        touchMap(source.key);
        map = { cid: cached.cid, blob: cached.blob };
      } else if (cid && stored) {
        map = { cid, blob: stored };
      } else {
        throw new MissingBytes("map");
      }
      const size =
        source.drawnAt ??
        (cached ? { width: cached.width, height: cached.height } : await sizeOf(map.blob));
      const blob = source.drawnAt
        ? await resizeBlob(map.blob, source.drawnAt.width, source.drawnAt.height)
        : map.blob;
      return encoded({ blob, name: "map.png", size, map }, source.encode);
    }
  }
}

export interface Uploader {
  readonly ledger: Ledger;
  /** Any source; null for a mask with nothing painted. */
  upload(source: Source): Promise<Upload | null>;
  /** A composed frame's pictures drawn at `drawnAt`, encoded for a provider when given one. */
  composite(frameId: string, drawnAt: Size, encode?: ProviderEncoding | null): Promise<Upload>;
  file(frameId: string, pictureId: string): Promise<string>;
  /** The frame's mask at `drawnAt`; null when nothing is painted. */
  mask(frameId: string, drawnAt: Size): Promise<string | null>;
  ipMask(frameId: string, maskId: string): Promise<string>;
  /** A map, as it is or resized to `drawnAt`, encoded for a provider when given one. */
  map(key: string, drawnAt?: Size | null, encode?: ProviderEncoding | null): Promise<Upload>;
}

/** An uploader over the frames a job is built from. */
export function createUploader(inputs: SourceFrames, held: HeldMaps = NO_MAPS): Uploader {
  const ledger: Ledger = { refs: {}, maps: {}, blobs: new Map() };
  const sent = new Map<string, Promise<Upload | null>>();
  const upload = (source: Source): Promise<Upload | null> => {
    // one picture is uploaded once per job, however many fields name it
    const key = canonicalJson(source);
    let pending = sent.get(key);
    if (!pending) {
      pending = (async () => {
        const made = await materialise(source, inputs, held);
        if (!made) return null;
        const ref = await uploadBlob(made.blob, made.name);
        ledger.refs[ref] = source;
        if (made.map && source.kind === "map") {
          ledger.maps[source.key] = made.map.cid;
          ledger.blobs.set(made.map.cid, made.map.blob);
        }
        return { ref, size: made.size };
      })();
      sent.set(key, pending);
    }
    return pending;
  };
  const required = async (source: Source): Promise<Upload> => {
    const done = await upload(source);
    if (!done) throw new Error("A picture could not be made to send");
    return done;
  };
  return {
    ledger,
    upload,
    composite: (frameId, drawnAt, encode = null) =>
      required({ kind: "composite", frameId, drawnAt, encode }),
    file: async (frameId, pictureId) => (await required({ kind: "file", frameId, pictureId })).ref,
    mask: async (frameId, drawnAt) =>
      (await upload({ kind: "mask", frameId, drawnAt }))?.ref ?? null,
    ipMask: async (frameId, maskId) => (await required({ kind: "ipMask", frameId, maskId })).ref,
    map: (key, drawnAt = null, encode = null) => required({ kind: "map", key, drawnAt, encode }),
  };
}

/** A recorded job's request with every upload made again from its sources, one
 * by one, and the new refs in the place of the old. */
export async function replay(
  job: Pick<StoredJob, "request" | "refs" | "maps">,
  inputs: SourceFrames,
  held: ReadonlyMap<string, Blob>,
): Promise<{ request: JobRequest; ledger: Ledger }> {
  const request = currentJobRequest(job.request as unknown as JobRequest);
  const up = createUploader(inputs, { cids: job.maps, blobs: held });
  const fresh = new Map<string, string>();
  for (const ref of refsIn(request)) {
    const source = job.refs[ref];
    if (!source) throw new ReplayError("picture");
    const done = await up.upload(source).catch((err: unknown) => {
      throw err instanceof MissingBytes ? new ReplayError(err.missing) : err;
    });
    // a mask the record names but whose frame now paints nothing
    if (!done) throw new ReplayError("mask");
    fresh.set(ref, done.ref);
  }
  return { request: substituteRefs(request, fresh), ledger: up.ledger };
}
