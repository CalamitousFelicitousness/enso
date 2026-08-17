export interface OutputPreset {
  id: string;
  label: string;
  codec: string;
  format: string;
  codecOptions: string;
  description: string;
}

export const OUTPUT_PRESETS: OutputPreset[] = [
  {
    id: "quick",
    label: "Quick Preview",
    codec: "libx264",
    format: "mp4",
    codecOptions: "crf=28",
    description: "Fast encode, smaller file",
  },
  {
    id: "balanced",
    label: "Balanced",
    codec: "libx264",
    format: "mp4",
    codecOptions: "crf=20",
    description: "Good quality, reasonable size",
  },
  {
    id: "high",
    label: "High Quality",
    codec: "libx265",
    format: "mp4",
    codecOptions: "crf=18",
    description: "Best quality, slower encode",
  },
  {
    id: "web",
    label: "Web Share",
    codec: "libx264",
    format: "mp4",
    codecOptions: "crf=23,faststart",
    description: "Optimized for web playback",
  },
  {
    id: "lossless",
    label: "Lossless",
    codec: "ffv1",
    format: "mkv",
    codecOptions: "",
    description: "No compression, large file",
  },
  {
    id: "custom",
    label: "Custom",
    codec: "",
    format: "",
    codecOptions: "",
    description: "Manual codec and format",
  },
];

export function qualityToCrf(quality: number): string {
  const crf = Math.round(51 - (quality / 100) * 41);
  return `crf=${Math.max(0, Math.min(51, crf))}`;
}

// Legacy spelling accepted: values persisted before the key=value switch
// still parse for display.
export function crfToQuality(codecOptions: string): number {
  const match = codecOptions.match(/crf[=:](\d+)/);
  if (!match) return 70;
  const crf = parseInt(match[1], 10);
  return Math.round(((51 - crf) / 41) * 100);
}

/** Rewrite legacy "key:value" assignments to "key=value". sdnext's option
 * parser treats ":" as a separator, so a legacy segment would land as two
 * flags (crf:16 -> crf=1, 16=1) instead of an assignment. Idempotent; bare
 * flags and existing key=value segments pass through. */
export function normalizeCodecOptions(value: string): string {
  return value
    .split(",")
    .map((seg) => (seg.includes("=") ? seg : seg.replace(":", "=")))
    .join(",");
}
