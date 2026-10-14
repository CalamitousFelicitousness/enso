// A file the server already holds, entering the page: its bytes are fetched
// fresh, and once it has entered it is taken into the store, so the hash the
// page then keeps for it is the server's.

import { adopt, type AdoptOrigin } from "@/api/blobs";
import { browserFilePath } from "@/api/browserFile";
import { outputIdOf } from "@/api/outputs";
import { mediaFile, mediaHead } from "@/lib/mediaFiles";

/** Enough of a file for its header, read before the rest is fetched. */
const HEAD_BYTES = 256 * 1024;

/** A picture the server holds, and what it holds it as. */
export interface ServerPicture {
  /** Its media URL: an output's or a Gallery file's. */
  url: string;
  name: string;
  origin: AdoptOrigin | null;
}

/** A result's picture: an output, taken in by its id when its URL is durable. */
export function resultPicture(url: string, name = "result.png"): ServerPicture {
  const outputId = outputIdOf(url);
  return { url, name, origin: outputId ? { outputId } : null };
}

/** A Gallery file, taken in by its path. */
export function galleryPicture(path: string): ServerPicture {
  return {
    url: browserFilePath(path),
    name: path.split("/").pop() ?? "gallery.png",
    origin: { path },
  };
}

/** The picture's bytes, never from the HTTP cache: a URL can come to name other bytes. */
export function serverFile(picture: ServerPicture): Promise<File> {
  return mediaFile(picture.url, picture.name, { cache: "no-store" });
}

/** The picture's first bytes, and whether they are the whole file. */
export function serverHead(picture: ServerPicture): Promise<{ file: File; whole: boolean }> {
  return mediaHead(picture.url, picture.name, HEAD_BYTES, { cache: "no-store" });
}

/** The hash the store keeps a file under once taken in, when the server's
 * copy is the size the page holds; null when it is not, or when the server
 * cannot take it (an older server, the store off). */
export async function adoptFile(origin: AdoptOrigin, size: number): Promise<string | null> {
  try {
    const answer = await adopt(origin);
    return answer.size === size ? answer.hash : null;
  } catch (err) {
    console.info("[adopt] the server did not take the file into its store", err);
    return null;
  }
}
