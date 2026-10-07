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
import type { AddressChange } from "./renumber";
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

/** "Input 2", "Inputs 2-3" for a run, "Inputs 2, 4" otherwise. */
export function positionsLabel(positions: number[]): string {
  const sorted = [...new Set(positions)].sort((a, b) => a - b);
  if (sorted.length === 1) return positionLabel(sorted[0]);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const run = last - first === sorted.length - 1;
  return `Inputs ${run ? `${first}-${last}` : sorted.join(", ")}`;
}

/** "Image 3": a sent picture by the number a prompt uses. */
export function addressLabel(address: Address): string {
  return `${KIND[address.kind]} ${address.n}`;
}

/** "Image 2", "Image 2-4", "Image 2, Video 1": addresses as ranges per kind.
 * Null for none. */
export function addressesLabel(addresses: Address[]): string | null {
  if (addresses.length === 0) return null;
  const numbers = new Map<MediaKind, number[]>();
  for (const address of addresses) {
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

/** What a frame sends, as `addressesLabel`. Null when it sends nothing. */
export function sentLabel(sent: SentInput[]): string | null {
  return addressesLabel(sent.map((s) => s.address));
}

/** "Not sent: no model". */
export function notSentLabel(reason: NotSentReason): string {
  return `Not sent: ${NOT_SENT[reason]}`;
}

/** "uses Input 1": a Control frame that sends another frame's picture. */
export function linkedLabel(position: number): string {
  return `uses ${positionLabel(position)}`;
}

/** One word for what a frame does in the next request. */
export function statusWord(entry: OutlineEntry): string {
  if (entry.blockedBy.length > 0) return "blocked";
  switch (entry.status) {
    case "off":
      return "off";
    case "empty":
      return "empty";
    case "notSent":
      return "not sent";
    case "sent":
      return "sent";
  }
}

function unreadableAt(positions: number[]): string | null {
  if (positions.length === 0) return null;
  return `A stored picture in ${positionsLabel(positions)} could not be read. Replace or remove it.`;
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

const imagesSent = (images: number) =>
  images > 1 ? "several input images" : "a Reference image sent at the size you set";

/** Why the request cannot carry the frames as they stand. */
export function problemText(problem: OutlineProblem): string {
  switch (problem.code) {
    case "mixedControlTypes": {
      const frames = problem.frames
        .map((f) => `${positionLabel(f.position)} (${CONTROL_TYPE[f.type]})`)
        .join(", ");
      return `Control frames must share one type: ${frames}.`;
    }
    case "tooManyImages": {
      const takes = problem.limit === 1 ? "one input image" : `up to ${problem.limit} input images`;
      return `This model takes ${takes}; the frames send ${problem.sent}.`;
    }
    case "unreadable":
      return unreadableAt(problem.positions) ?? "";
    case "maskWithSet":
      return `The mask on ${positionsLabel(problem.positions)} cannot be sent with ${imagesSent(problem.images)}.`;
    case "controlWithSet":
      return `${positionsLabel(problem.positions)} cannot be sent with ${imagesSent(problem.images)}.`;
  }
}

/** What the fix for a problem does, as a button label. */
export function fixLabel(problem: OutlineProblem): string {
  switch (problem.code) {
    case "mixedControlTypes": {
      const keep = problem.frames[0]?.type;
      const others = problem.frames.filter((f) => f.type !== keep).map((f) => f.position);
      return `Turn off ${positionsLabel(others)}`;
    }
    case "tooManyImages": {
      // pictures of set frames can be hidden one by one; a composite only with its frame
      const composed = problem.over.filter((o) => o.pictureId === null);
      if (composed.length > 0) return `Turn off ${positionsLabel(problem.positions)}`;
      return `Hide ${addressesLabel(problem.over.map((o) => o.address)) ?? ""}`;
    }
    case "controlWithSet":
      return `Turn off ${positionsLabel(problem.positions)}`;
    case "unreadable":
      return "Remove the unreadable pictures";
    case "maskWithSet":
      return "Clear the mask";
  }
}

/** "Image 4 is now Image 2, Image 5 is now Image 3". Null without a change. */
export function renumberText(changes: AddressChange[]): string | null {
  if (changes.length === 0) return null;
  return changes.map((c) => `${addressLabel(c.from)} is now ${addressLabel(c.to)}`).join(", ");
}

/** The picked size source is no longer sent, so Width and Height stay. */
export const SIZE_SOURCE_LOST_TEXT =
  "The image the size came from is no longer sent. Width and Height stay as they are.";
export const SIZE_SOURCE_FIRST_LABEL = "Use Image 1";

/** The server predates the sdnext change that lets a control unit keep its own picture beside an Initial picture. */
export const CONTROL_PICTURE_SERVER_TEXT =
  "Control pictures beside an Initial picture need a newer sdnext (the control fix of 2026-10-05). Update the server, or turn the control units off.";
