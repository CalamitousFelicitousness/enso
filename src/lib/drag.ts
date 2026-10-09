// What the app's own drags carry. Pictures and library entries travel under
// different types, so a target that takes only pictures refuses an entry
// while it is still being dragged, before anything is dropped.

import { loose } from "@/lib/inputs/loose";

/** A picture dragged from a result or the gallery. */
export type ImagePayload =
  | { type: "result-image"; resultId: string; imageIndex: number; src?: string | undefined }
  | {
      type: "gallery-image";
      filePath: string;
      fileId?: string | undefined;
      src?: string | undefined;
    };

/** A library entry dragged onto the inputs. */
export interface EntryPayload {
  type: "library-entry";
  entryId: string;
  src?: string | undefined;
}

export type DragPayload = ImagePayload | EntryPayload;

export const IMAGE_MIME = "application/x-enso-image";
export const ENTRY_MIME = "application/x-enso-entry";

/** The type a payload travels under. */
export function mimeOf(payload: DragPayload): string {
  return payload.type === "library-entry" ? ENTRY_MIME : IMAGE_MIME;
}

/** A payload read back from a drop; null for anything else. */
export function readPayload(raw: string): DragPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const p = loose<Record<string, unknown>>(value);
  if (!p) return null;
  const src = typeof p["src"] === "string" ? p["src"] : undefined;
  switch (p["type"]) {
    case "result-image":
      return typeof p["resultId"] === "string" && typeof p["imageIndex"] === "number"
        ? { type: "result-image", resultId: p["resultId"], imageIndex: p["imageIndex"], src }
        : null;
    case "gallery-image":
      return typeof p["filePath"] === "string"
        ? {
            type: "gallery-image",
            filePath: p["filePath"],
            fileId: typeof p["fileId"] === "string" ? p["fileId"] : undefined,
            src,
          }
        : null;
    case "library-entry":
      return typeof p["entryId"] === "string"
        ? { type: "library-entry", entryId: p["entryId"], src }
        : null;
    default:
      return null;
  }
}
