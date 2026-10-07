// The words for inputs, in one place: the canvas, the Input tab, toasts and
// accessible names all read them from here.

import type {
  Address,
  NotSentReason,
  Outline,
  OutlineEntry,
  OutlineProblem,
  SentInput,
} from "./outline";
import type { ControlType, FrameRole, MediaKind } from "./types";

const KIND: Record<MediaKind, string> = { image: "Image", video: "Video", audio: "Audio" };
const ROLE: Record<FrameRole, string> = {
  initial: "Initial",
  reference: "Reference",
  control: "Control",
  ipAdapter: "IP-Adapter",
};
const CONTROL_TYPE: Record<ControlType, string> = {
  controlnet: "ControlNet",
  t2i: "T2I-Adapter",
  xs: "XS",
  lite: "Lite",
  style_transfer: "Style Transfer",
};
const NOT_SENT: Record<NotSentReason, string> = {
  noModel: "no model",
  noPicture: "no picture",
  linkBroken: "its source frame is gone",
};

export function roleLabel(role: FrameRole): string {
  return ROLE[role];
}

export function controlTypeLabel(type: ControlType): string {
  return CONTROL_TYPE[type];
}

/** "Input 2": a frame by its place in the list. */
export function positionLabel(position: number): string {
  return `Input ${position}`;
}

/** "Image 3": a sent picture by the number a prompt uses. */
export function addressLabel(address: Address): string {
  return `${KIND[address.kind]} ${address.n}`;
}

/** What a frame sends: "Image 2", "Image 2-4", "Image 2, Video 1". Null when
 * it sends nothing. */
export function sentLabel(sent: SentInput[]): string | null {
  if (sent.length === 0) return null;
  const numbers = new Map<MediaKind, number[]>();
  for (const { address } of sent) {
    numbers.set(address.kind, [...(numbers.get(address.kind) ?? []), address.n]);
  }
  return [...numbers]
    .map(([kind, ns]) => {
      const first = Math.min(...ns);
      const last = Math.max(...ns);
      return first === last ? `${KIND[kind]} ${first}` : `${KIND[kind]} ${first}-${last}`;
    })
    .join(", ");
}

/** "Not sent: no model". */
export function notSentLabel(reason: NotSentReason): string {
  return `Not sent: ${NOT_SENT[reason]}`;
}

/** "uses Input 1": a Control frame that sends another frame's picture. */
export function linkedLabel(position: number): string {
  return `uses ${positionLabel(position)}`;
}

function unreadableAt(positions: number[]): string | null {
  if (positions.length === 0) return null;
  const where = [...positions]
    .sort((a, b) => a - b)
    .map(positionLabel)
    .join(", ");
  return `A stored picture in ${where} could not be read. Replace or remove it.`;
}

/** Why a job cannot be built from these inputs, or null. */
export function unreadableText(entries: OutlineEntry[]): string | null {
  return unreadableAt(
    entries.filter((e) => e.sent.some((s) => s.unreadable)).map((e) => e.position),
  );
}

/** The same, for the pictures Control and IP-Adapter frames send. */
export function unreadableControlText(
  outline: Pick<Outline, "controls" | "ipAdapters">,
): string | null {
  return unreadableAt(
    [...outline.controls, ...outline.ipAdapters].filter((s) => s.unreadable).map((s) => s.position),
  );
}

/** Why the request cannot carry the frames as they stand. */
export function problemText(problem: OutlineProblem): string {
  const frames = problem.frames
    .map((f) => `${positionLabel(f.position)} (${CONTROL_TYPE[f.type]})`)
    .join(", ");
  return `Control frames must share one type: ${frames}. Switch the type or turn some off.`;
}

/** The server predates the sdnext change that lets a control unit keep its own picture beside an Initial picture. */
export const CONTROL_PICTURE_SERVER_TEXT =
  "Control pictures beside an Initial picture need a newer sdnext (the control fix of 2026-10-05). Update the server, or turn the control units off.";
