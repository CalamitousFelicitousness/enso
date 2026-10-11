// The one way a picture gets into an input frame, whatever brought it: a
// drop, a paste, the file picker, or "send to canvas" from a result.

import { toast } from "sonner";
import { isVideoFile } from "@/lib/mediaType";
import { outlineEntry } from "@/lib/inputs/outline";
import { positionLabel, VIDEO_TO_CANVAS_TEXT } from "@/lib/inputs/text";
import { inputsReady, useInputStore, type NewPicture } from "@/stores/inputStore";
import { adoptFile, serverFile, type ServerPicture } from "./adopt";
import { rememberHashes, type Hashed } from "./db";
import { imageSize } from "./media";
import { outlineOf } from "./outlineOf";

/** A type that says the file is something other than an image. A missing or
 * generic type says nothing: the server sends results and gallery files it
 * has no type for as octet-stream, and the browser may still decode them. */
function namedAsOther(file: File): boolean {
  return (
    file.type !== "" && file.type !== "application/octet-stream" && !file.type.startsWith("image/")
  );
}

/** A file as a picture: its bytes copied into memory and its size decoded. A
 * File from a drop or a picker is a reference to a path on disk, which can
 * move or change before the bytes are stored or uploaded. Rejects for a file
 * that is not an image the browser can decode. */
async function toPicture(file: File): Promise<NewPicture> {
  if (namedAsOther(file)) throw new Error("not an image");
  const snapshot = new File([await file.arrayBuffer()], file.name, {
    type: file.type,
    lastModified: file.lastModified,
  });
  const { width, height } = await imageSize(snapshot);
  return { file: snapshot, name: file.name, width, height };
}

/** A picture that entered a frame. */
export interface Added {
  pictureId: string;
  cid: string;
}

/** Add image files to an input frame: the one given, else the selected one,
 * else the first. Every file is decoded before any is added, so they land in
 * the order given, which is the order sent. Answers what entered, file by
 * file; null for a file refused or unreadable. */
export async function addFilesToInputs(
  files: File[],
  frameId: string | null = null,
): Promise<(Added | null)[]> {
  const decoded = await Promise.allSettled(files.map(toPicture));
  await inputsReady();
  const store = useInputStore.getState();
  const entered: (Added | null)[] = files.map(() => null);
  const wanted = frameId ?? store.selectedFrameId;
  const frame = store.frames.find((f) => f.id === wanted) ?? store.frames[0];
  if (!frame) return entered;
  if (frameId) store.selectFrame(frame.id);
  // A linked Control frame shows another frame's picture; its own would be
  // invisible until the link is cleared, so the drop is refused, not hidden.
  if (frame.link) {
    const entry = outlineEntry(outlineOf(store.frames), frame.id);
    const name = entry ? positionLabel(entry.position) : "This frame";
    const source = entry?.linkedTo != null ? positionLabel(entry.linkedTo) : "another frame";
    toast.info(`${name} uses ${source}'s picture. Unlink it in Options to give it its own.`);
    return entered;
  }

  let added = 0;
  let unreadable = 0;
  decoded.forEach((result, i) => {
    if (result.status !== "fulfilled") {
      unreadable += 1;
      return;
    }
    // the model's image limit refuses and says so
    const pictureId = store.addPicture(frame.id, result.value);
    if (pictureId === null) return;
    added += 1;
    const cid = useInputStore
      .getState()
      .frames.find((f) => f.id === frame.id)
      ?.pictures.find((p) => p.id === pictureId)?.cid;
    if (cid) entered[i] = { pictureId, cid };
  });
  const failed = unreadable;
  if (failed > 0) {
    toast.error(
      failed === 1
        ? "A file is not an image Enso can read"
        : `${failed} files are not images Enso can read`,
    );
  }
  // Without a frame under the pointer, say where the pictures went
  if (added > 0 && !frameId && store.frames.length > 1) {
    const entry = outlineEntry(outlineOf(useInputStore.getState().frames), frame.id);
    if (entry) toast.info(`Added to ${positionLabel(entry.position)}`);
  }
  return entered;
}

/** Add pictures the server holds. Each that entered a frame is taken into the
 * store and its hash kept, so it goes to the server as a claim, not as bytes;
 * nothing is copied for a picture the frame refused. A video is refused
 * before any byte is fetched. */
export async function addServerPictures(
  pictures: ServerPicture[],
  frameId: string | null = null,
): Promise<void> {
  const images = pictures.filter((p) => !isVideoFile(p.name));
  if (images.length < pictures.length) toast.info(VIDEO_TO_CANVAS_TEXT);
  if (images.length === 0) return;
  const files = await Promise.all(images.map(serverFile));
  const entered = await addFilesToInputs(files, frameId);
  void rememberAdopted(images, files, entered);
}

async function rememberAdopted(
  pictures: ServerPicture[],
  files: File[],
  entered: (Added | null)[],
): Promise<void> {
  const rows = new Map<string, Hashed>();
  await Promise.all(
    entered.map(async (added, i) => {
      const origin = pictures[i].origin;
      if (!added || !origin) return;
      const hash = await adoptFile(origin, files[i].size);
      if (hash) rows.set(added.cid, { hash, size: files[i].size });
    }),
  );
  await rememberHashes(rows).catch((err: unknown) =>
    console.warn("[adopt] the hashes of adopted pictures could not be kept", err),
  );
}
