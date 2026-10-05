// What the user should be told about stored inputs: content that could not be
// read back, and what an import from an older build did to it.

import type { ImportNote } from "./legacy";
import type { JoinLoss } from "./stored";
import { positionLabel } from "./text";

export interface InputReport {
  lost: JoinLoss;
  notes: ImportNote[];
  /** A record of an older build is there and could not be read. */
  legacyUnread: boolean;
}

/** A report with `more` added; null when there is nothing to tell. */
export function addToReport(
  report: InputReport | null,
  more: Partial<InputReport>,
): InputReport | null {
  const next: InputReport = {
    lost: {
      pictures: [...(report?.lost.pictures ?? []), ...(more.lost?.pictures ?? [])],
      maskObjects: (report?.lost.maskObjects ?? 0) + (more.lost?.maskObjects ?? 0),
    },
    notes: [...(report?.notes ?? []), ...(more.notes ?? [])],
    legacyUnread: (report?.legacyUnread ?? false) || (more.legacyUnread ?? false),
  };
  const empty =
    next.lost.pictures.length === 0 &&
    next.lost.maskObjects === 0 &&
    next.notes.length === 0 &&
    !next.legacyUnread;
  return empty ? null : next;
}

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** The report as lines to read. `positionOf` gives a frame's place in the
 * list now, or null when the frame is gone. */
export function reportLines(
  report: InputReport,
  positionOf: (frameId: string) => number | null,
): string[] {
  const lines: string[] = [];
  for (const { frameId, name } of report.lost.pictures) {
    const position = positionOf(frameId);
    const where = position === null ? "" : ` in ${positionLabel(position)}`;
    lines.push(`"${name}"${where} could not be read. Replace or remove it.`);
  }
  if (report.lost.maskObjects > 0) {
    lines.push(
      `${count(report.lost.maskObjects, "mask", "masks")} could not be read and ${report.lost.maskObjects === 1 ? "was" : "were"} left out.`,
    );
  }
  for (const note of report.notes) {
    const where = positionLabel(note.position);
    if (note.kind === "otherMode") {
      lines.push(
        `${where}: ${count(note.count, "picture", "pictures")} from its other mode ${note.count === 1 ? "is" : "are"} kept hidden and not sent.`,
      );
    } else if (note.kind === "unreadablePicture") {
      lines.push(`${where}: "${note.name}" could not be read. Replace or remove it.`);
    } else if (note.kind === "unreadableMask") {
      lines.push(
        `${where}: ${count(note.count, "mask", "masks")} could not be read and ${note.count === 1 ? "was" : "were"} left out.`,
      );
    } else {
      lines.push(
        `${where}: ${count(note.count, "item", "items")} this version does not know ${note.count === 1 ? "was" : "were"} left out.`,
      );
    }
  }
  if (report.legacyUnread) {
    lines.push(
      "Inputs saved by an earlier version could not be read. They will be tried again the next time the page loads.",
    );
  }
  return lines;
}
