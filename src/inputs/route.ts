// The one way a picture gets into an input frame, whatever brought it: a
// drop, a paste, the file picker, or "send to canvas" from a result.

import { toast } from "sonner";
import { isVideoFile } from "@/lib/mediaType";
import { outlineEntry } from "@/lib/inputs/outline";
import { positionLabel, VIDEO_TO_CANVAS_TEXT } from "@/lib/inputs/text";
import type { ImageHeader } from "@/lib/media/dimensions";
import { SLOW_DECODE_PIXELS, type Destination } from "@/lib/media/limits";
import { readingText } from "@/lib/media/text";
import { inputsReady, useInputStore, type NewPicture } from "@/stores/inputStore";
import { adoptFile, serverFile, serverHead, type ServerPicture } from "./adopt";
import { admit, announceRefusals, decodedTooLarge, type Refused } from "./admit";
import { rememberHashes, type Hashed } from "./db";
import { imageSize } from "./media";
import { outlineOf } from "./outlineOf";

/** Pictures decoded at once; each holds a whole picture in memory. */
const DECODES_AT_ONCE = 2;

let decoding = 0;
const waiting: (() => void)[] = [];

async function inTurn<T>(task: () => Promise<T>): Promise<T> {
  if (decoding >= DECODES_AT_ONCE) await new Promise<void>((resolve) => waiting.push(resolve));
  decoding += 1;
  try {
    return await task();
  } finally {
    decoding -= 1;
    waiting.shift()?.();
  }
}

type Sized = Extract<ImageHeader, { orientation: number }>;

/** A picture ready for a frame, its bytes held as a File. */
export type Prepared = NewPicture & { file: File };

/** An admitted file as a picture: its bytes copied into memory, since a File
 * from a drop or a picker refers to a path that can change before the bytes
 * are stored, and its size decoded and held to the limit again. */
async function decodePicture(file: File, header: Sized | null): Promise<Prepared | Refused> {
  const pixels = header ? header.size.width * header.size.height : 0;
  const reading =
    pixels > SLOW_DECODE_PIXELS ? toast.loading(readingText(file.name, pixels)) : null;
  try {
    const snapshot = new File([await file.arrayBuffer()], file.name, {
      type: file.type,
      lastModified: file.lastModified,
    });
    const size = await imageSize(snapshot);
    const refusal = decodedTooLarge(size);
    if (refusal) return { name: file.name, refusal };
    return { file: snapshot, name: file.name, ...size };
  } finally {
    if (reading !== null) toast.dismiss(reading);
  }
}

/** Files as pictures for `where`, in the order given: each admitted from its
 * header before any byte is copied, then decoded two at a time. Refused and
 * unreadable files are said in one toast per reason and answer null. */
export async function preparePictures(
  files: File[],
  where: Destination = "images",
): Promise<(Prepared | null)[]> {
  const admitted = await Promise.all(files.map((file) => admit(file, where)));
  const refused: Refused[] = [];
  let unreadable = 0;
  const prepared = await Promise.all(
    files.map(async (file, i) => {
      const admission = admitted[i];
      if (!admission.ok) {
        refused.push({ name: file.name, refusal: admission.refusal });
        return null;
      }
      const header = admission.header.size === null ? null : admission.header;
      try {
        const picture = await inTurn(() => decodePicture(file, header));
        if ("refusal" in picture) {
          refused.push(picture);
          return null;
        }
        return picture;
      } catch {
        unreadable += 1;
        return null;
      }
    }),
  );
  announceRefusals(refused);
  if (unreadable > 0) {
    toast.error(
      unreadable === 1
        ? "A file is not an image Enso can read"
        : `${unreadable} files are not images Enso can read`,
    );
  }
  return prepared;
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
  await inputsReady();
  const entered: (Added | null)[] = files.map(() => null);
  const wanted = frameId ?? useInputStore.getState().selectedFrameId;
  const target = useInputStore.getState().frames.find((f) => f.id === wanted);
  // A linked Control frame shows another frame's picture; its own would be
  // invisible until the link is cleared, so the drop is refused, not hidden.
  if (target?.link) {
    const store = useInputStore.getState();
    if (frameId) store.selectFrame(target.id);
    const entry = outlineEntry(outlineOf(store.frames), target.id);
    const name = entry ? positionLabel(entry.position) : "This frame";
    const source = entry?.linkedTo != null ? positionLabel(entry.linkedTo) : "another frame";
    toast.info(`${name} uses ${source}'s picture. Unlink it in Options to give it its own.`);
    return entered;
  }
  const prepared = await preparePictures(files);
  const store = useInputStore.getState();
  const frame = store.frames.find((f) => f.id === wanted) ?? store.frames[0];
  if (!frame) return entered;
  if (frameId) store.selectFrame(frame.id);

  let added = 0;
  prepared.forEach((picture, i) => {
    if (!picture) return;
    // the model's image limit refuses and says so
    const pictureId = store.addPicture(frame.id, picture);
    if (pictureId === null) return;
    added += 1;
    const cid = useInputStore
      .getState()
      .frames.find((f) => f.id === frame.id)
      ?.pictures.find((p) => p.id === pictureId)?.cid;
    if (cid) entered[i] = { pictureId, cid };
  });
  // Without a frame under the pointer, say where the pictures went
  if (added > 0 && !frameId && store.frames.length > 1) {
    const entry = outlineEntry(outlineOf(useInputStore.getState().frames), frame.id);
    if (entry) toast.info(`Added to ${positionLabel(entry.position)}`);
  }
  return entered;
}

/** The pictures' bytes, each admitted from its first bytes before the rest is
 * fetched; null for one refused, which is said. */
export async function fetchAdmitted(
  pictures: ServerPicture[],
  where: Destination = "images",
): Promise<(File | null)[]> {
  const refused: Refused[] = [];
  const files = await Promise.all(
    pictures.map(async (picture) => {
      try {
        const head = await serverHead(picture);
        let file = head.whole ? head.file : null;
        let admission = await admit(head.file, where);
        if (!admission.ok && admission.refusal.reason === "noSize" && !head.whole) {
          // a header that runs past the head is read from the whole file
          file = await serverFile(picture);
          admission = await admit(file, where);
        }
        if (!admission.ok) {
          refused.push({ name: picture.name, refusal: admission.refusal });
          return null;
        }
        return file ?? (await serverFile(picture));
      } catch (err) {
        toast.error(`${picture.name} could not be read`, {
          description: err instanceof Error ? err.message : undefined,
        });
        return null;
      }
    }),
  );
  announceRefusals(refused);
  return files;
}

/** Add pictures the server holds. Each that entered a frame is taken into the
 * store and its hash kept, so it goes to the server as a claim, not as bytes;
 * nothing is copied for a picture the frame refused. A video is refused
 * before any byte is fetched, a picture over the limits after its head.
 * Answers whether any entered. */
export async function addServerPictures(
  pictures: ServerPicture[],
  frameId: string | null = null,
): Promise<boolean> {
  const images = pictures.filter((p) => !isVideoFile(p.name));
  if (images.length < pictures.length) toast.info(VIDEO_TO_CANVAS_TEXT);
  if (images.length === 0) return false;
  const fetched = await fetchAdmitted(images);
  const kept = images.filter((_, i) => fetched[i] !== null);
  const files = fetched.filter((file) => file !== null);
  if (files.length === 0) return false;
  const entered = await addFilesToInputs(files, frameId);
  void rememberAdopted(kept, files, entered);
  return entered.some((added) => added !== null);
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
