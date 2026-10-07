// What the frame list means: where each frame stands, what it sends, the
// number each sent picture answers to, the map each processed picture is
// sent as, and what keeps the request from being built. Both the canvas and
// the Input tab read their labels from here, and the request builder sends
// exactly `sent`, `controls` and `ipAdapters`.

import { compositeSpec, completeParams, fileSpec, mapKey, type PictureSpec } from "./freshness";
import { unreadableText } from "./text";
import {
  activeProcessor,
  composedPictures,
  hasMask,
  isComposed,
  slotPictures,
  type ControlSettings,
  type ControlType,
  type Frame,
  type FrameRole,
  type IpAdapterSettings,
  type JsonValue,
  type MediaKind,
  type PlacedPicture,
  type ProcessorSpec,
  type Size,
} from "./types";

/** How a prompt names a sent picture: "Image 3". Counted per kind across all frames. */
export interface Address {
  kind: MediaKind;
  n: number;
}

/** Where a processed picture's map stands. "needed": no map for this content
 * yet; "unknown": the cache has not been asked yet. */
export type MapState = "current" | "needed" | "queued" | "processing" | "failed" | "unknown";

/** The map a picture is sent as: its key, what it is made from, and where it stands. */
export interface MapSlot {
  key: string;
  processor: ProcessorSpec;
  /** Parameters as sent: the frame's over the server's defaults. */
  params: Record<string, JsonValue>;
  spec: PictureSpec;
  state: MapState;
  /** Why the processor failed, with state "failed". */
  reason: string | null;
}

export interface SentInput {
  address: Address;
  frameId: string;
  role: FrameRole;
  /** The picture a Reference frame sends; null for an Initial frame's composite. */
  pictureId: string | null;
  /** Natural size of that picture, or of the composite's bottom picture. */
  width: number;
  height: number;
  /** The frame carries mask strokes or mask objects. */
  masked: boolean;
  /** Bytes it is made of could not be read. */
  unreadable: boolean;
  /** The map sent in the picture's place, when the frame has a processor
   * and the outline was given the processing facts. */
  map: MapSlot | null;
}

/** "off": switched off. "empty": on, with nothing to send. "notSent": on and
 * holding content, which no control model takes for the reason in `notSent`. */
export type FrameStatus = "sent" | "empty" | "off" | "notSent";

/** Why a Control or IP-Adapter frame that is on sends nothing. */
export type NotSentReason = "noModel" | "noPicture" | "linkBroken";

/** One cell of a set frame: a picture it shows, sent or hidden. */
export interface OutlineSlot {
  pictureId: string;
  /** Null while the picture is not sent, always for a control picture. */
  address: Address | null;
}

export type ProblemCode = OutlineProblem["code"];

export interface OutlineEntry {
  frameId: string;
  /** The N of "Input N": the frame's place in the list, whatever it holds. */
  position: number;
  role: FrameRole;
  status: FrameStatus;
  notSent: NotSentReason | null;
  sent: SentInput[];
  /** A set frame's pictures in order, leaving out those a role switch hid.
   * Empty for a composed frame. */
  slots: OutlineSlot[];
  /** Pictures the last role switch hid. */
  hiddenBySwitch: number;
  /** Position of the frame a Control frame takes its picture from, when linked. */
  linkedTo: number | null;
  /** The processor the frame's pictures go through, by id, whether or not
   * the frame sends; null when it has none or its role takes none. */
  processor: string | null;
  /** The maps this frame's sent pictures are replaced by. */
  maps: MapSlot[];
  /** The problems this frame is part of. */
  blockedBy: ProblemCode[];
}

/** A Control frame's picture as it travels: the composite of `sourceFrameId`
 * under the frame's settings, or its map. */
export interface ControlSend {
  frameId: string;
  position: number;
  sourceFrameId: string;
  settings: ControlSettings;
  map: MapSlot | null;
  unreadable: boolean;
}

export interface IpAdapterSend {
  frameId: string;
  position: number;
  pictureIds: string[];
  settings: IpAdapterSettings;
  unreadable: boolean;
}

/** Something the request cannot carry as the frames stand. Each one has words
 * in text.ts and a fix: in problems.ts, or, for `cloudMaps`, a processing job. */
export type OutlineProblem =
  | { code: "mixedControlTypes"; frames: { position: number; type: ControlType }[] }
  /** More images sent than the model takes: `over` lists the pictures past
   * the limit, `positions` the frames they are in. */
  | {
      code: "tooManyImages";
      limit: number;
      sent: number;
      positions: number[];
      over: { position: number; frameId: string; pictureId: string | null; address: Address }[];
    }
  /** Frames sending a picture whose bytes could not be read. */
  | { code: "unreadable"; positions: number[] }
  /** Initial frames with a mask while the images go out as a set, which takes no mask. */
  | { code: "maskWithSet"; positions: number[]; images: number }
  /** Control and IP-Adapter frames sending while the images go out as a set. */
  | { code: "controlWithSet"; positions: number[]; images: number }
  /** Frames whose map is not current on a model that runs elsewhere and cannot process. */
  | { code: "cloudMaps"; positions: number[] };

export interface Outline {
  entries: OutlineEntry[];
  /** Everything sent to the model's image list, in the order the model receives it. */
  sent: SentInput[];
  controls: ControlSend[];
  ipAdapters: IpAdapterSend[];
  /** The images go out as one set: several of them, or a lone Reference on a
   * model whose output size the request sets. */
  set: boolean;
  problems: OutlineProblem[];
}

/** What the outline needs to say where each map stands. Without it no slot
 * is computed and `map` is null everywhere. */
export interface ProcessingEnv {
  /** The runner's revision, part of every key. */
  revision: string;
  /** Each processor's default parameters, by id. */
  defaults: Record<string, Record<string, JsonValue>>;
  /** Keys whose map the cache holds. */
  current: Pick<ReadonlySet<string>, "has">;
  /** Keys the cache has been asked about, found or not. */
  lookedUp: ReadonlySet<string>;
  /** Keys a job is making. */
  pending: ReadonlyMap<string, "queued" | "processing">;
  /** Keys whose last run failed, with the reason. */
  failed: ReadonlyMap<string, string>;
  /** The model runs elsewhere and cannot process, so every map must be current. */
  cloud: boolean;
  /** Counts every change to the cache, the jobs and the failures, for callers
   * that key a cache of outlines on these facts. */
  stamp: number;
  /** Width and Height as set. */
  frame: Size;
  /** The size the model generates at, which a set, a separate init and
   * every control picture are resized to before they go out. */
  target: Size;
}

export interface OutlineEnv {
  /** The loaded checkpoint carries its control model, so a ControlNet frame needs none. */
  controlUnified?: boolean;
  /** Most input images the model takes in one request; null or absent while unknown. */
  maxInputImages?: number | null;
  /** The request sets the output size, also from a single input image. */
  requestSetsSize?: boolean | null;
  processing?: ProcessingEnv | null;
}

type Unnumbered = Omit<SentInput, "address" | "map"> & { kind: MediaKind };

function frameSends(frame: Frame): Unnumbered[] {
  if (!frame.enabled) return [];
  const shared = { frameId: frame.id, role: frame.role };
  if (isComposed(frame.role)) {
    const layers = composedPictures(frame);
    if (layers.length === 0) return [];
    return [
      {
        ...shared,
        kind: "image",
        pictureId: null,
        width: layers[0].width,
        height: layers[0].height,
        masked: hasMask(frame),
        unreadable: layers.some((p) => p.file === null),
      },
    ];
  }
  return slotPictures(frame).map((p) => ({
    ...shared,
    kind: p.media,
    pictureId: p.id,
    width: p.width,
    height: p.height,
    masked: false,
    unreadable: p.file === null,
  }));
}

function needsModel(settings: ControlSettings, env: OutlineEnv): boolean {
  if (settings.type === "style_transfer") return false;
  return !(settings.type === "controlnet" && env.controlUnified);
}

/** The frame whose composite a Control frame sends: its link's target, else itself. */
function controlSource(
  frames: Frame[],
  frame: Frame,
): { source: Frame; layers: PlacedPicture[] } | "linkBroken" {
  if (!frame.link) return { source: frame, layers: composedPictures(frame) };
  const target = frames.find((f) => f.id === frame.link?.frameId);
  if (!target || target.id === frame.id || !isComposed(target.role)) return "linkBroken";
  return { source: target, layers: composedPictures(target) };
}

function mapState(key: string, env: ProcessingEnv): Pick<MapSlot, "state" | "reason"> {
  if (env.current.has(key)) return { state: "current", reason: null };
  const pending = env.pending.get(key);
  if (pending) return { state: pending, reason: null };
  const reason = env.failed.get(key);
  if (reason !== undefined) return { state: "failed", reason };
  return { state: env.lookedUp.has(key) ? "needed" : "unknown", reason: null };
}

function mapSlot(spec: PictureSpec, processor: ProcessorSpec, env: ProcessingEnv): MapSlot {
  const params = completeParams(processor, env.defaults[processor.id]);
  const key = mapKey(spec, processor, params, env.revision);
  return { key, processor, params, spec, ...mapState(key, env) };
}

type Settled = Omit<OutlineEntry, "blockedBy" | "maps">;

const ascending = (positions: Iterable<number>) => [...new Set(positions)].sort((a, b) => a - b);

function findProblems(
  entries: Settled[],
  sent: SentInput[],
  controls: ControlSend[],
  ipAdapters: IpAdapterSend[],
  set: boolean,
  env: OutlineEnv,
): OutlineProblem[] {
  const problems: OutlineProblem[] = [];
  const positionOf = new Map(entries.map((e) => [e.frameId, e.position]));
  const limit = env.maxInputImages ?? null;
  if (limit !== null && sent.length > limit) {
    const over = sent.slice(limit).map((s) => ({
      position: positionOf.get(s.frameId) ?? 0,
      frameId: s.frameId,
      pictureId: s.pictureId,
      address: s.address,
    }));
    problems.push({
      code: "tooManyImages",
      limit,
      sent: sent.length,
      positions: ascending(over.map((o) => o.position)),
      over,
    });
  }
  const unreadable = ascending([
    ...sent.filter((s) => s.unreadable).map((s) => positionOf.get(s.frameId) ?? 0),
    ...[...controls, ...ipAdapters].filter((s) => s.unreadable).map((s) => s.position),
  ]);
  if (unreadable.length > 0) problems.push({ code: "unreadable", positions: unreadable });
  if (set) {
    const masked = ascending(
      sent.filter((s) => s.masked).map((s) => positionOf.get(s.frameId) ?? 0),
    );
    if (masked.length > 0) {
      problems.push({ code: "maskWithSet", positions: masked, images: sent.length });
    }
    const control = ascending([...controls, ...ipAdapters].map((s) => s.position));
    if (control.length > 0) {
      problems.push({ code: "controlWithSet", positions: control, images: sent.length });
    }
  }
  const types = [...new Set(controls.map((c) => c.settings.type))];
  if (types.length > 1) {
    problems.push({
      code: "mixedControlTypes",
      frames: controls.map((c) => ({ position: c.position, type: c.settings.type })),
    });
  }
  if (env.processing?.cloud) {
    // Only the image list goes to a provider. A key not looked up yet is not
    // a problem until the cache has answered.
    const stale = (map: MapSlot | null) =>
      map !== null && map.state !== "current" && map.state !== "unknown";
    const positions = ascending(
      sent.filter((s) => stale(s.map)).map((s) => positionOf.get(s.frameId) ?? 0),
    );
    if (positions.length > 0) problems.push({ code: "cloudMaps", positions });
  }
  return problems;
}

/** The positions a problem names. */
export function problemPositions(problem: OutlineProblem): number[] {
  return problem.code === "mixedControlTypes"
    ? problem.frames.map((f) => f.position)
    : problem.positions;
}

export function computeOutline(frames: Frame[], env: OutlineEnv = {}): Outline {
  const next: Record<MediaKind, number> = { image: 1, video: 1, audio: 1 };
  const controls: ControlSend[] = [];
  const ipAdapters: IpAdapterSend[] = [];
  const sources = new Map<string, Frame>();
  const settled = frames.map((frame, index): Settled => {
    const position = index + 1;
    const shown = isComposed(frame.role) ? [] : frame.pictures.filter((p) => !p.hiddenBySwitch);
    const linkedIndex = frame.link ? frames.findIndex((f) => f.id === frame.link?.frameId) : -1;
    const entry = {
      frameId: frame.id,
      position,
      role: frame.role,
      hiddenBySwitch: frame.pictures.filter((p) => p.hiddenBySwitch).length,
      linkedTo: frame.role === "control" && linkedIndex !== -1 ? linkedIndex + 1 : null,
      processor: activeProcessor(frame)?.id ?? null,
    };
    const settle = (status: FrameStatus, notSent: NotSentReason | null = null) => ({
      ...entry,
      status,
      notSent,
      sent: [] as SentInput[],
      slots: shown.map((p) => ({ pictureId: p.id, address: null })),
    });
    if (!frame.enabled) return settle("off");
    if (frame.role === "control") {
      const resolved = controlSource(frames, frame);
      if (resolved === "linkBroken") return settle("notSent", "linkBroken");
      if (resolved.layers.length === 0)
        return settle(frame.link ? "notSent" : "empty", frame.link ? "noPicture" : null);
      if (needsModel(frame.control, env) && frame.control.model === "None") {
        return settle("notSent", "noModel");
      }
      sources.set(frame.id, resolved.source);
      controls.push({
        frameId: frame.id,
        position,
        sourceFrameId: resolved.source.id,
        settings: frame.control,
        map: null,
        unreadable: resolved.layers.some((p) => p.file === null),
      });
      return settle("sent");
    }
    if (frame.role === "ipAdapter") {
      const pictures = slotPictures(frame);
      if (pictures.length === 0) return settle("empty");
      if (frame.ipAdapter.adapter === "None") return settle("notSent", "noModel");
      ipAdapters.push({
        frameId: frame.id,
        position,
        pictureIds: pictures.map((p) => p.id),
        settings: frame.ipAdapter,
        unreadable: [...pictures, ...frame.ipAdapter.masks].some((p) => p.file === null),
      });
      return settle("sent");
    }
    const sent = frameSends(frame).map(({ kind, ...rest }): SentInput => {
      return { ...rest, address: { kind, n: next[kind]++ }, map: null };
    });
    return {
      ...settle(sent.length > 0 ? "sent" : "empty"),
      sent,
      slots: shown.map((p) => ({
        pictureId: p.id,
        address: sent.find((s) => s.pictureId === p.id)?.address ?? null,
      })),
    };
  });
  const plain = settled.flatMap((e) => e.sent);
  const set =
    plain.length > 1 ||
    (plain.length === 1 && plain[0].role === "reference" && env.requestSetsSize === true);

  // The maps, once it is known how the pictures travel: a plain img2img
  // init goes out at frame size and the server resizes it; a set, a
  // separate init beside control pictures, and every control picture are
  // resized to the generation size first.
  const processing = env.processing ?? null;
  const frameOf = new Map(frames.map((f) => [f.id, f]));
  const withMap = (input: SentInput): SentInput => {
    const frame = frameOf.get(input.frameId);
    const processor = frame && activeProcessor(frame);
    if (!processing || !frame || !processor) return input;
    if (input.pictureId !== null) {
      const picture = frame.pictures.find((p) => p.id === input.pictureId);
      return picture ? { ...input, map: mapSlot(fileSpec(picture), processor, processing) } : input;
    }
    const out = set || controls.length > 0 ? processing.target : processing.frame;
    const spec = compositeSpec(composedPictures(frame), processing.frame, out);
    return { ...input, map: mapSlot(spec, processor, processing) };
  };
  const mapped = processing
    ? settled.map((e) => (e.sent.length > 0 ? { ...e, sent: e.sent.map(withMap) } : e))
    : settled;
  if (processing) {
    for (const send of controls) {
      const frame = frameOf.get(send.frameId);
      const source = sources.get(send.frameId);
      const processor = frame && activeProcessor(frame);
      if (!frame || !source || !processor) continue;
      const spec = compositeSpec(composedPictures(source), processing.frame, processing.target);
      send.map = mapSlot(spec, processor, processing);
    }
  }
  const sent = mapped.flatMap((e) => e.sent);
  const problems = findProblems(mapped, sent, controls, ipAdapters, set, env);
  const controlMaps = new Map(controls.map((c) => [c.frameId, c.map]));
  const entries = mapped.map((entry): OutlineEntry => {
    const own = controlMaps.get(entry.frameId);
    const maps = own ? [own] : entry.sent.flatMap((s) => (s.map ? [s.map] : []));
    return {
      ...entry,
      maps,
      blockedBy: problems
        .filter((p) => problemPositions(p).includes(entry.position))
        .map((p) => p.code),
    };
  });
  return { entries, sent, controls, ipAdapters, set, problems };
}

export function outlineEntry(outline: Outline, frameId: string): OutlineEntry | undefined {
  return outline.entries.find((e) => e.frameId === frameId);
}

/** The first Initial frame that sends a picture. */
export function firstInitialEntry(outline: Outline): OutlineEntry | undefined {
  return outline.entries.find((e) => e.role === "initial" && e.sent.length > 0);
}

/** The layers of the first Initial frame that sends a picture, bottom to top;
 * null when none does. Throws, with words for the user, when one of the
 * layers could not be read. */
export function firstComposite(frames: Frame[]): PlacedPicture[] | null {
  const entry = firstInitialEntry(computeOutline(frames));
  const frame = entry && frames.find((f) => f.id === entry.frameId);
  if (!entry || !frame) return null;
  const unreadable = unreadableText([entry]);
  if (unreadable) throw new Error(unreadable);
  return composedPictures(frame);
}

/** The Reference picture that is the only thing sent, else null. */
export function loneReference(outline: Outline): SentInput | null {
  const [only, ...rest] = outline.sent;
  return only && rest.length === 0 && only.role === "reference" ? only : null;
}

/** The number a Control frame's picture would get if the frame were sent as
 * an image instead (a Reference frame), or null when it would send nothing. */
export function sentAsImage(
  frames: Frame[],
  frameId: string,
  env: OutlineEnv = {},
): Address | null {
  const switched = frames.map((f): Frame => (f.id === frameId ? { ...f, role: "reference" } : f));
  const entry = outlineEntry(computeOutline(switched, env), frameId);
  return entry?.sent[0]?.address ?? null;
}

/** A sent picture picked to set the frame size: a frame, plus one of its
 * pictures when the pick was made on a Reference frame. */
export interface SizeSourcePick {
  frameId: string;
  pictureId: string | null;
}

export function sizeSourcePick(input: SentInput): SizeSourcePick {
  return { frameId: input.frameId, pictureId: input.pictureId };
}

/** Where the frame size comes from. "first": Image 1, nothing picked.
 * "lost": the picked picture is no longer sent while others are, so the size
 * stays as it is until the pick changes. */
export type SizeSourceState =
  | { kind: "none" }
  | { kind: "first"; input: SentInput }
  | { kind: "picked"; input: SentInput }
  | { kind: "lost"; pick: SizeSourcePick };

/** A pick follows its frame across a role switch, to the frame's first
 * picture or to its composite. */
export function sizeSourceState(sent: SentInput[], pick: SizeSourcePick | null): SizeSourceState {
  if (sent.length === 0) return { kind: "none" };
  if (!pick) return { kind: "first", input: sent[0] };
  const picked = sent.find(
    (s) =>
      s.frameId === pick.frameId &&
      (s.pictureId === null || pick.pictureId === null || s.pictureId === pick.pictureId),
  );
  return picked ? { kind: "picked", input: picked } : { kind: "lost", pick };
}

/** The sent picture that sets the frame size, or null: nothing is sent, or
 * the pick is lost and the size is kept. */
export function resolveSizeSource(
  sent: SentInput[],
  pick: SizeSourcePick | null,
): SentInput | null {
  const state = sizeSourceState(sent, pick);
  return state.kind === "first" || state.kind === "picked" ? state.input : null;
}
