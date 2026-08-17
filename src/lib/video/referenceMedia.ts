// Reference media classification and metadata probing. The extension lists
// mirror the sdnext core's MEDIA_EXTENSIONS: staged uploads keep their
// extension, so a file classified here is what the server will accept.
import type { VideoModelCaps } from "@/api/types/video";

export type ReferenceKind = "image" | "video" | "audio";

const EXTENSIONS: Record<ReferenceKind, readonly string[]> = {
  image: [".png", ".jpg", ".jpeg", ".webp"],
  video: [".mp4", ".mov", ".avi"],
  audio: [".wav", ".mp3", ".flac", ".aac"],
};

export function classifyReferenceFile(name: string): ReferenceKind | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = name.slice(dot).toLowerCase();
  for (const kind of ["image", "video", "audio"] as const) {
    if (EXTENSIONS[kind].includes(ext)) return kind;
  }
  return null;
}

/** File-picker accept string for the references slot, gated by the model's
 * per-kind limits. Explicit extensions rather than wildcards: image/* would
 * admit formats (gif) the server's classifier rejects. */
export function referenceAccept(refs: VideoModelCaps["references"]): string {
  const parts: string[] = [...EXTENSIONS.image];
  if (refs.max_videos > 0) parts.push(...EXTENSIONS.video);
  if (refs.max_audio > 0) parts.push(...EXTENSIONS.audio);
  return parts.join(",");
}

export interface ReferenceAddress {
  /** Prompt address, e.g. "<Picture 2>" or "<Audio 1> <Video 1>". */
  address: string;
  /** Compact canvas-badge form, e.g. "P2" or "A1·V1". */
  badge: string;
}

/** Per-modality prompt addresses in request order: <Picture N> / <Video N> /
 * <Audio N>, matching the server's numbering. A soundtracked video takes an
 * audio number too, audio label first; hasAudio null (browser can't tell)
 * counts as silent, so numbering after it may differ from the server's. */
export function referenceAddresses(
  refs: readonly { kind: ReferenceKind; hasAudio: boolean | null }[],
): ReferenceAddress[] {
  let pictures = 0;
  let videos = 0;
  let audios = 0;
  return refs.map((r) => {
    if (r.kind === "video") {
      videos += 1;
      if (r.hasAudio) {
        audios += 1;
        return { address: `<Audio ${audios}> <Video ${videos}>`, badge: `A${audios}·V${videos}` };
      }
      return { address: `<Video ${videos}>`, badge: `V${videos}` };
    }
    if (r.kind === "audio") {
      audios += 1;
      return { address: `<Audio ${audios}>`, badge: `A${audios}` };
    }
    pictures += 1;
    return { address: `<Picture ${pictures}>`, badge: `P${pictures}` };
  });
}

export interface VideoProbe {
  width: number;
  height: number;
  duration: number;
  /** null = the browser can't tell without decoding; badge falls back to a
   * plain <Video N> label. */
  hasAudio: boolean | null;
  posterUrl: string | null;
}

export function probeVideoFile(objectUrl: string): Promise<VideoProbe> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.src = objectUrl;
    video.onerror = () => reject(new Error("Could not read video metadata"));
    // loadeddata guarantees the first frame is decodable for the poster grab.
    video.onloadeddata = () => {
      const el = video as HTMLVideoElement & {
        mozHasAudio?: boolean;
        webkitAudioDecodedByteCount?: number;
        audioTracks?: { length: number };
      };
      let hasAudio: boolean | null = null;
      if (el.audioTracks !== undefined) hasAudio = el.audioTracks.length > 0;
      else if (el.mozHasAudio !== undefined) hasAudio = el.mozHasAudio;
      else if (el.webkitAudioDecodedByteCount !== undefined && el.webkitAudioDecodedByteCount > 0)
        hasAudio = true;

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")?.drawImage(video, 0, 0);
      canvas.toBlob(
        (blob) => {
          resolve({
            width: video.videoWidth,
            height: video.videoHeight,
            duration: video.duration,
            hasAudio,
            posterUrl: blob ? URL.createObjectURL(blob) : null,
          });
        },
        "image/jpeg",
        0.8,
      );
    };
  });
}

export function probeAudioFile(objectUrl: string): Promise<{ duration: number }> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = objectUrl;
    audio.onerror = () => reject(new Error("Could not read audio metadata"));
    audio.onloadedmetadata = () => resolve({ duration: audio.duration });
  });
}
