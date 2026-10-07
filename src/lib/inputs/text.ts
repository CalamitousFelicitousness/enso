// The words for inputs, in one place: the canvas, the Input tab, toasts and
// accessible names all read them from here.

import type { Address, OutlineEntry, SentInput } from "./outline";
import type { FrameRole, MediaKind } from "./types";

const KIND: Record<MediaKind, string> = { image: "Image", video: "Video", audio: "Audio" };
const ROLE: Record<FrameRole, string> = { initial: "Initial", reference: "Reference" };

export function roleLabel(role: FrameRole): string {
  return ROLE[role];
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

/** Why a job cannot be built from these inputs, or null. */
export function unreadableText(entries: OutlineEntry[]): string | null {
  const blocked = entries.filter((e) => e.sent.some((s) => s.unreadable));
  if (blocked.length === 0) return null;
  const where = blocked.map((e) => positionLabel(e.position)).join(", ");
  return `A stored picture in ${where} could not be read. Replace or remove it.`;
}

/** The server predates the sdnext change that lets a control unit keep its own picture beside an Initial picture. */
export const CONTROL_PICTURE_SERVER_TEXT =
  "Control pictures beside an Initial picture need a newer sdnext (the control fix of 2026-10-05). Update the server, or turn the control units off.";
