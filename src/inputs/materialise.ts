// The one way an image job's pictures leave the document. A builder asks the
// uploader for a picture by its source (a frame's pictures drawn at a size, a
// picture's file, a frame's mask, an IP-Adapter region mask, a map); the
// uploader makes the bytes and stages them on the action's batch, which
// answers a placeholder in the place of the upload's ref and keeps the source
// under it. Bytes this page derived the same way before are made again only
// when the server lacks them. The record's own pictures are staged beside the
// request's, kept with the job only.

import { getInputLimits } from "@/lib/cloudLimits";
import { exportMask } from "@/lib/exportMask";
import { flattenCanvas } from "@/lib/flattenCanvas";
import { canonicalJson } from "@/lib/inputs/freshness";
import { optimizeImageForProvider } from "@/lib/imageOptimize";
import type { ProviderEncoding, Source } from "@/lib/inputs/stored";
import { composedPictures, type Frame, type MaskContent, type Size } from "@/lib/inputs/types";
import { ReplayError } from "@/lib/jobs/replay";
import type { ReplayMissing } from "@/lib/jobs/text";
import { compositeKey, mapSendKey } from "@/lib/media/keys";
import { resizeBlob } from "@/lib/resize";
import { headerSize } from "./admit";
import { currentMap, touchMap } from "./maps";
import { derivedFor, type Bytes, type StageOptions, type UploadBatch } from "./uploads";

/** What a job's uploads came from. */
export interface Ledger {
  /** The source of each upload, by the placeholder it was staged under. */
  refs: Record<string, Source>;
  /** The cid of each map sent as a picture, by key. */
  maps: Record<string, string>;
  /** The placeholder of each cid's own bytes the record names: pictures, mask
   * objects, region masks and the maps sent as pictures. */
  cids: Map<string, string>;
}

export function emptyLedger(): Ledger {
  return { refs: {}, maps: {}, cids: new Map() };
}

/** The frames pictures are made from, and the frame size their placements are in. */
export interface SourceFrames {
  frames: Frame[];
  size: Size;
}

/** The bytes of maps a record kept, by key and cid. */
export interface HeldMaps {
  cids: Readonly<Record<string, string>>;
  blobs: ReadonlyMap<string, Blob>;
}

const NO_MAPS: HeldMaps = { cids: {}, blobs: new Map() };

export interface Upload {
  ref: string;
  /** The size the picture goes out at. */
  size: Size;
}

interface Made {
  blob: Blob;
  name: string;
  size: Size;
}

interface FoundMap {
  cid: string;
  blob: Blob;
  /** Null when only its bytes say. */
  size: Size | null;
}

/** What making bytes reaches beyond the frames; the tests pass their own. */
export interface MakeTools {
  flatten: typeof flattenCanvas;
  exportMask: typeof exportMask;
  resize: (blob: Blob, width: number, height: number) => Promise<Blob>;
  optimise: (blob: Blob, encode: ProviderEncoding) => Promise<Made>;
  currentMap: (key: string) => { cid: string; blob: Blob; width: number; height: number } | null;
  touchMap: (key: string) => void;
  sizeOf: (blob: Blob) => Promise<Size>;
}

async function optimise(blob: Blob, encode: ProviderEncoding): Promise<Made> {
  const limits = getInputLimits(encode.provider, encode.model);
  const optimized = await optimizeImageForProvider(blob, limits, encode.provider);
  return {
    blob: optimized.blob,
    name: `cloud-input.${optimized.format}`,
    size: optimized.dimensions,
  };
}

async function sizeOf(blob: Blob): Promise<Size> {
  const known = await headerSize(blob);
  if (known) return known;
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

const MAKE_TOOLS: MakeTools = {
  flatten: flattenCanvas,
  exportMask,
  resize: resizeBlob,
  optimise,
  currentMap,
  touchMap,
  sizeOf,
};

function frameOf(inputs: SourceFrames, frameId: string, missing: ReplayMissing): Frame {
  const frame = inputs.frames.find((f) => f.id === frameId);
  if (!frame) throw new ReplayError(missing);
  return frame;
}

/** A map's bytes: the cache's, touched, else the ones a record kept. */
function findMap(key: string, held: HeldMaps, tools: MakeTools): FoundMap | null {
  const cached = tools.currentMap(key);
  if (cached) {
    tools.touchMap(key);
    return {
      cid: cached.cid,
      blob: cached.blob,
      size: { width: cached.width, height: cached.height },
    };
  }
  const cid = held.cids[key];
  const blob = cid ? held.blobs.get(cid) : undefined;
  return cid && blob ? { cid, blob, size: null } : null;
}

async function encoded(made: Made, encode: ProviderEncoding | null, tools: MakeTools) {
  return encode ? tools.optimise(made.blob, encode) : made;
}

/** The bytes of a source, made from the frames; null for a mask with nothing
 * painted. Throws ReplayError when the bytes a source needs are not there. */
export async function materialise(
  source: Source,
  inputs: SourceFrames,
  held: HeldMaps = NO_MAPS,
  partial: Partial<MakeTools> = {},
): Promise<Made | null> {
  const tools = { ...MAKE_TOOLS, ...partial };
  switch (source.kind) {
    case "composite": {
      const layers = composedPictures(frameOf(inputs, source.frameId, "picture"));
      if (layers.some((l) => !l.file)) throw new ReplayError("picture");
      const flat = await tools.flatten(
        layers,
        inputs.size.width,
        inputs.size.height,
        source.drawnAt,
      );
      if (!flat) throw new Error("A frame holds no picture to send");
      return encoded({ blob: flat, name: "input.png", size: source.drawnAt }, source.encode, tools);
    }
    case "file": {
      const picture = frameOf(inputs, source.frameId, "picture").pictures.find(
        (p) => p.id === source.pictureId,
      );
      if (!picture?.file) throw new ReplayError("picture");
      return {
        blob: picture.file,
        name: picture.name,
        size: { width: picture.width, height: picture.height },
      };
    }
    case "mask": {
      const { mask } = frameOf(inputs, source.frameId, "mask");
      const blob = await tools.exportMask(
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
          : await tools.resize(blob, width, height);
      return { blob: sized, name: "mask.png", size: source.drawnAt };
    }
    case "ipMask": {
      const mask = frameOf(inputs, source.frameId, "mask").ipAdapter.masks.find(
        (m) => m.id === source.maskId,
      );
      if (!mask?.file) throw new ReplayError("mask");
      return { blob: mask.file, name: mask.name, size: { width: mask.width, height: mask.height } };
    }
    case "map": {
      const map = findMap(source.key, held, tools);
      if (!map) throw new ReplayError("map");
      const size = source.drawnAt ?? map.size ?? (await tools.sizeOf(map.blob));
      const blob = source.drawnAt
        ? await tools.resize(map.blob, source.drawnAt.width, source.drawnAt.height)
        : map.blob;
      return encoded({ blob, name: "map.png", size }, source.encode, tools);
    }
  }
}

/** An identity for a frame's mask content: the reducers leave an untouched
 * mask the same object, so its export is remembered by it. */
const maskIds = new WeakMap<MaskContent, string>();
let maskCount = 0;

function maskKey(mask: MaskContent, frame: Size, drawnAt: Size): string {
  let id = maskIds.get(mask);
  if (!id) {
    maskCount += 1;
    id = String(maskCount);
    maskIds.set(mask, id);
  }
  return `mask|${id}|${frame.width}x${frame.height}|${drawnAt.width}x${drawnAt.height}`;
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
  /** Stage, to keep with the record only, the bytes of every picture, mask
   * object and region mask the frames name and of every map sent as a picture. */
  stageRecord(frames: readonly Frame[]): void;
}

export interface UploaderOptions {
  held?: HeldMaps;
  tools?: Partial<MakeTools>;
}

/** An uploader over the frames a job is built from, staging on `batch`. */
export function createUploader(
  inputs: SourceFrames,
  batch: UploadBatch,
  options: UploaderOptions = {},
): Uploader {
  const tools = { ...MAKE_TOOLS, ...options.tools };
  const held = options.held ?? NO_MAPS;
  const ledger = emptyLedger();
  // the bytes of each map sent as a picture, by cid, for the record
  const mapBytes = new Map<string, Blob>();
  const sent = new Map<string, Promise<Upload | null>>();

  const stage = (bytes: Bytes, source: Source, stageOptions: StageOptions): string => {
    const { ref } = batch.stage(bytes, { ...stageOptions, source });
    ledger.refs[ref] = source;
    if (stageOptions.cid) ledger.cids.set(stageOptions.cid, ref);
    return ref;
  };

  // Derived bytes the page sent before are claimed by their hash and made
  // again only when the server lacks them
  const derived = async (source: Source, key: string): Promise<Upload | null> => {
    const memo = derivedFor(key);
    if (memo) {
      const size = { width: memo.width, height: memo.height };
      const make = async () => (await materialise(source, inputs, held, tools))?.blob ?? null;
      return { ref: stage(make, source, { name: memo.name, key, dims: size }), size };
    }
    const made = await materialise(source, inputs, held, tools);
    if (!made) return null;
    return {
      ref: stage(made.blob, source, { name: made.name, key, dims: made.size }),
      size: made.size,
    };
  };

  const make = async (source: Source): Promise<Upload | null> => {
    switch (source.kind) {
      case "composite": {
        const layers = composedPictures(frameOf(inputs, source.frameId, "picture"));
        return derived(source, compositeKey(layers, inputs.size, source.drawnAt, source.encode));
      }
      case "file": {
        const picture = frameOf(inputs, source.frameId, "picture").pictures.find(
          (p) => p.id === source.pictureId,
        );
        if (!picture) throw new ReplayError("picture");
        // bytes this browser lost go from the server's copy when it holds one
        const ref = stage(picture.file, source, { name: picture.name, cid: picture.cid });
        return { ref, size: { width: picture.width, height: picture.height } };
      }
      case "mask": {
        const { mask } = frameOf(inputs, source.frameId, "mask");
        return derived(source, maskKey(mask, inputs.size, source.drawnAt));
      }
      case "ipMask": {
        const mask = frameOf(inputs, source.frameId, "mask").ipAdapter.masks.find(
          (m) => m.id === source.maskId,
        );
        if (!mask) throw new ReplayError("mask");
        const ref = stage(mask.file, source, { name: mask.name, cid: mask.cid });
        return { ref, size: { width: mask.width, height: mask.height } };
      }
      case "map": {
        const map = findMap(source.key, held, tools);
        if (!map) throw new ReplayError("map");
        ledger.maps[source.key] = map.cid;
        mapBytes.set(map.cid, map.blob);
        if (source.drawnAt || source.encode) {
          return derived(source, mapSendKey(source.key, source.drawnAt, source.encode));
        }
        const ref = stage(map.blob, source, { name: "map.png", cid: map.cid });
        return { ref, size: map.size ?? (await tools.sizeOf(map.blob)) };
      }
    }
  };

  const upload = (source: Source): Promise<Upload | null> => {
    // one picture is staged once per job, however many fields name it
    const key = canonicalJson(source);
    let pending = sent.get(key);
    if (!pending) {
      pending = make(source);
      sent.set(key, pending);
    }
    return pending;
  };
  const required = async (source: Source): Promise<Upload> => {
    const done = await upload(source);
    if (!done) throw new Error("A picture could not be made to send");
    return done;
  };
  const keep = (bytes: Blob | null, cid: string, name: string) => {
    ledger.cids.set(cid, batch.stage(bytes, { name, cid, record: true }).ref);
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
    stageRecord: (frames) => {
      for (const frame of frames) {
        for (const p of frame.pictures) keep(p.file, p.cid, p.name);
        for (const o of frame.mask.objects) keep(o.blob, o.cid, o.name);
        for (const m of frame.ipAdapter.masks) keep(m.file, m.cid, m.name);
      }
      for (const [cid, blob] of mapBytes) keep(blob, cid, "map.png");
    },
  };
}
