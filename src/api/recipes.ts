// Recipe files: the server packs an entry or the current state into a .enso
// file the browser downloads, and reads one sent back into the library.

import { UserAbortError } from "@/lib/abort";
import { postRaw, type RawOptions } from "./blobs";
import { api } from "./client";
import type { ReqExportBodyV2, ResExportV2, ResImportV2 } from "./types/media";

/** Pack a stored entry, or the current state as a body; the answer names the
 * file to download. Rejects with UserAbortError when the signal stops it. */
export async function postExport(
  body: { entry_id: string } | ReqExportBodyV2,
  signal?: AbortSignal,
): Promise<ResExportV2> {
  try {
    return await api.post<ResExportV2>("/sdapi/v2/export", body, signal);
  } catch (err) {
    if (signal?.aborted) throw new UserAbortError("Export cancelled");
    throw err;
  }
}

/** Where a packed file is served for an hour; load it through mediaUrl. */
export function exportUrl(packed: Pick<ResExportV2, "id" | "name">): string {
  return `/sdapi/v2/export/${encodeURIComponent(packed.id)}?name=${encodeURIComponent(packed.name)}`;
}

/** Send a recipe file to the library: 201 for a new entry, 200 for one it holds already. */
export function postImport(file: Blob, options: RawOptions = {}): Promise<ResImportV2> {
  return postRaw<ResImportV2>("/sdapi/v2/import", file, options);
}
