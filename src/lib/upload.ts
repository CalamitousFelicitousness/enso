import { UploadRefused } from "@/api/blobs";
import { UploadBatch, type Staged } from "@/inputs/uploads";
import { isGone, type Outcome } from "@/lib/media/stage";

function refOf(outcomes: ReadonlyMap<string, Outcome>, staged: Staged, name: string): string {
  const outcome = outcomes.get(staged.ref);
  if (!outcome || isGone(outcome)) throw new UploadRefused({ kind: "unreadable", name });
  return outcome.ref;
}

/** Send a file to the media store; its upload ref. */
export function uploadFile(file: File): Promise<string> {
  return uploadBlob(file, file.name);
}

/** Send several files in one batch; their upload refs, in order. */
export async function uploadFiles(files: File[]): Promise<string[]> {
  if (files.length === 0) return [];
  const batch = new UploadBatch("files");
  const staged = files.map((file) => batch.stage(file, { name: file.name }));
  const outcomes = await batch.run();
  return staged.map((s, i) => refOf(outcomes, s, files[i].name));
}

/** Send bytes to the media store; their upload ref. */
export async function uploadBlob(blob: Blob, filename = "upload.png"): Promise<string> {
  const batch = new UploadBatch(filename);
  const staged = batch.stage(blob, { name: filename });
  return refOf(await batch.run(), staged, filename);
}
