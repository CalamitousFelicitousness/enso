// What the frame list means: where each frame stands, what it sends, and the
// number each sent picture answers to. Both the canvas and the Input tab read
// their labels from here, and the request builder sends exactly `sent`.

import { unreadableText } from "./text";
import {
  composedPictures,
  hasMask,
  isComposed,
  slotPictures,
  type Frame,
  type FrameRole,
  type MediaKind,
  type PlacedPicture,
} from "./types";

/** How a prompt names a sent picture: "Image 3". Counted per kind across all frames. */
export interface Address {
  kind: MediaKind;
  n: number;
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
}

/** "off": switched off. "empty": on, with nothing to send. */
export type FrameStatus = "sent" | "empty" | "off";

/** One cell of a Reference frame: a picture it shows, sent or hidden. */
export interface OutlineSlot {
  pictureId: string;
  /** Null while the picture is not sent. */
  address: Address | null;
}

export interface OutlineEntry {
  frameId: string;
  /** The N of "Input N": the frame's place in the list, whatever it holds. */
  position: number;
  role: FrameRole;
  status: FrameStatus;
  sent: SentInput[];
  /** A Reference frame's pictures in order, leaving out those a role switch
   * hid. Empty for an Initial frame. */
  slots: OutlineSlot[];
  /** Pictures the last role switch hid. */
  hiddenBySwitch: number;
}

export interface Outline {
  entries: OutlineEntry[];
  /** Everything sent, in the order the model receives it. */
  sent: SentInput[];
}

type Unnumbered = Omit<SentInput, "address"> & { kind: MediaKind };

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

export function computeOutline(frames: Frame[]): Outline {
  const next: Record<MediaKind, number> = { image: 1, video: 1, audio: 1 };
  const entries = frames.map((frame, index): OutlineEntry => {
    const sent = frameSends(frame).map(({ kind, ...rest }): SentInput => {
      return { ...rest, address: { kind, n: next[kind]++ } };
    });
    const shown = isComposed(frame.role) ? [] : frame.pictures.filter((p) => !p.hiddenBySwitch);
    return {
      frameId: frame.id,
      position: index + 1,
      role: frame.role,
      status: !frame.enabled ? "off" : sent.length > 0 ? "sent" : "empty",
      sent,
      slots: shown.map((p) => ({
        pictureId: p.id,
        address: sent.find((s) => s.pictureId === p.id)?.address ?? null,
      })),
      hiddenBySwitch: frame.pictures.filter((p) => p.hiddenBySwitch).length,
    };
  });
  return { entries, sent: entries.flatMap((e) => e.sent) };
}

/** "Input N" of a control unit. Units are not frames yet, so they follow them. */
export function controlUnitPosition(frameCount: number, unitIndex: number): number {
  return frameCount + 1 + unitIndex;
}

export function outlineEntry(outline: Outline, frameId: string): OutlineEntry | undefined {
  return outline.entries.find((e) => e.frameId === frameId);
}

/** The layers of the first Initial frame that sends a picture, bottom to top;
 * null when none does. Throws, with words for the user, when one of the
 * layers could not be read. */
export function firstComposite(frames: Frame[]): PlacedPicture[] | null {
  const entry = computeOutline(frames).entries.find(
    (e) => e.role === "initial" && e.sent.length > 0,
  );
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

/** A sent picture picked to set the frame size: a frame, plus one of its
 * pictures when the pick was made on a Reference frame. */
export interface SizeSourcePick {
  frameId: string;
  pictureId: string | null;
}

export function sizeSourcePick(input: SentInput): SizeSourcePick {
  return { frameId: input.frameId, pictureId: input.pictureId };
}

/** The sent picture that sets the frame size: the pick while it is still
 * sent, else the first one. A pick follows its frame across a role switch, to
 * the frame's first picture or to its composite. */
export function resolveSizeSource(
  sent: SentInput[],
  pick: SizeSourcePick | null,
): SentInput | null {
  const picked = pick
    ? sent.find(
        (s) =>
          s.frameId === pick.frameId &&
          (s.pictureId === null || pick.pictureId === null || s.pictureId === pick.pictureId),
      )
    : undefined;
  return picked ?? sent[0] ?? null;
}
