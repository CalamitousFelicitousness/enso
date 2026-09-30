// Browse links open on the civitai.red mirror; API requests stay on civitai.com.
export const CIVITAI_SITE = "https://civitai.red";

export function civitaiModelUrl(modelId: number, versionId?: number): string {
  return `${CIVITAI_SITE}/models/${modelId}${versionId ? `?modelVersionId=${versionId}` : ""}`;
}

export function civitaiUserUrl(username: string): string {
  return `${CIVITAI_SITE}/user/${encodeURIComponent(username)}`;
}

interface PeekFile {
  id: number;
  name: string;
  downloadUrl?: string;
}

// Every safetensors file of an open version gets probed; the backend caches
// by file id so repeats are free.
export function civitFilePeekTargets<T extends PeekFile>(files: T[]): T[] {
  return files.filter((f) => f.name.toLowerCase().endsWith(".safetensors"));
}

// Family the version's base tag implies, comparable against probe.arch.family.
const BASE_FAMILY_HINTS: [RegExp, string][] = [
  [/krea/i, "krea2"],
  [/wan video/i, "wanai"],
  [/qwen/i, "qwen"],
  [/flux\s*\.?\s*2|klein/i, "f2"],
  [/flux/i, "f1"],
  [/chroma/i, "chroma"],
  [/ideogram/i, "ideogram4"],
  [/sdxl|pony|illustrious|noobai/i, "sdxl"],
  [/^sd 3/i, "sd3"],
  [/^sd [12]\./i, "sd"],
  [/ltx/i, "ltxvideo"],
  [/z.?image/i, "zimage"],
  [/anima/i, "anima"],
  [/ernie/i, "ernieimage"],
];

export function civitBaseFamily(baseModel: string | null | undefined): string | null {
  if (!baseModel) return null;
  for (const [re, family] of BASE_FAMILY_HINTS) {
    if (re.test(baseModel)) return family;
  }
  return null;
}

const DTYPE_PRECISION: Record<string, string> = {
  F32: "fp32",
  F16: "fp16",
  BF16: "bf16",
  F8_E4M3: "fp8_e4m3fn",
  F8_E5M2: "fp8_e5m2",
};

export function precisionFromDtype(dtype: string | null | undefined): string | null {
  return dtype ? (DTYPE_PRECISION[dtype] ?? null) : null;
}

const QUANT_FORMAT_LABELS: Record<string, string> = {
  int8_tensorwise: "int8",
  float8_e4m3fn: "fp8_e4m3fn",
  float8_e5m2: "fp8_e5m2",
};

export function quantFormatLabel(format: string | null | undefined): string | null {
  return format ? (QUANT_FORMAT_LABELS[format] ?? format) : null;
}
