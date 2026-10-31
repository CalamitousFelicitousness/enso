import type { VideoCodec } from "@/api/types/video";

/** The codecs offered before sdnext listed its own, for a server without the codecs route. */
export const FALLBACK_CODECS: VideoCodec[] = [
  {
    name: "libx264",
    title: "H.264 / AVC",
    description: "Standard for web and streaming compatibility.",
    ext: "mp4",
    allowed_exts: ["mp4", "mkv", "mov", "ts"],
    options: "crf=18:preset=medium",
    pix_fmt: "yuv420p",
    hardware: false,
    available: true,
  },
  {
    name: "libx265",
    title: "HEVC / H.265",
    description: "High efficiency compression for 4K video.",
    ext: "mp4",
    allowed_exts: ["mp4", "mkv", "mov", "ts"],
    options: "crf=22:preset=medium",
    pix_fmt: "yuv420p",
    hardware: false,
    available: true,
  },
  {
    name: "libvpx-vp9",
    title: "VP9 Video",
    description: "Royalty-free web video format.",
    ext: "webm",
    allowed_exts: ["webm", "mkv"],
    options: "crf=23:b=0",
    pix_fmt: "yuv420p",
    hardware: false,
    available: true,
  },
  {
    name: "ffv1",
    title: "Lossless Archival (FFV1)",
    description: "",
    ext: "mkv",
    allowed_exts: ["mkv", "avi"],
    options: "level=3:coder=1:context=1:slices=16",
    pix_fmt: "yuv420p",
    hardware: false,
    available: true,
  },
];

export function codecRow(codecs: readonly VideoCodec[], name: string): VideoCodec | undefined {
  return codecs.find((c) => c.name === name);
}

/** Codec picker groups: software, then hardware, then the codecs this server cannot use, disabled. */
export function codecGroups(codecs: readonly VideoCodec[]) {
  const option = (c: VideoCodec) => ({
    value: c.name,
    label: c.title,
    disabled: c.available !== true,
  });
  return [
    { heading: "Software", options: codecs.filter((c) => c.available && !c.hardware).map(option) },
    { heading: "Hardware", options: codecs.filter((c) => c.available && c.hardware).map(option) },
    { heading: "Not available", options: codecs.filter((c) => !c.available).map(option) },
  ].filter((g) => g.options.length > 0);
}

/** Containers the codec writes; every listed container for a codec the table does not know. */
export function formatsFor(codecs: readonly VideoCodec[], name: string): string[] {
  const row = codecRow(codecs, name);
  if (row) return row.allowed_exts;
  return [...new Set(codecs.flatMap((c) => c.allowed_exts))];
}

/** Format and options after picking a codec: the format kept where the codec writes it, else
 * the codec's own; the codec's tuned options, comma separated as the Codec opts field shows them. */
export function pickCodec(
  row: VideoCodec,
  format: string,
): { format: string; codecOptions: string } {
  return {
    format: row.allowed_exts.includes(format) ? format : row.ext,
    codecOptions: row.options.split(":").filter(Boolean).join(","),
  };
}

function listText(items: readonly string[]): string {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/** Why a job with this codec and format fails, or null. */
export function outputProblem(
  codecs: readonly VideoCodec[],
  name: string,
  format: string,
): string | null {
  const row = codecRow(codecs, name);
  if (row?.available === false)
    return `${row.title} is not available on this server, so the job will fail.`;
  if (row?.available === null) return "This server cannot encode video, so the job will fail.";
  const formats = formatsFor(codecs, name);
  if (format && formats.length > 0 && !formats.includes(format)) {
    return `${row?.title ?? name} cannot be saved as ${format}, so the job will fail. It saves as ${listText(formats)}.`;
  }
  return null;
}
