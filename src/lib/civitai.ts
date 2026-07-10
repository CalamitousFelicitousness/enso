// Browse links open on the civitai.red mirror; API requests stay on civitai.com.
export const CIVITAI_SITE = "https://civitai.red";

export function civitaiModelUrl(modelId: number, versionId?: number): string {
  return `${CIVITAI_SITE}/models/${modelId}${versionId ? `?modelVersionId=${versionId}` : ""}`;
}

export function civitaiUserUrl(username: string): string {
  return `${CIVITAI_SITE}/user/${encodeURIComponent(username)}`;
}

function insertNameSuffix(name: string, suffix: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}-${suffix}${name.slice(dot)}` : `${name}-${suffix}`;
}

interface VariantFile {
  id: number;
  name: string;
  downloadUrl?: string;
  metadata?: { fp?: string | null; size?: string | null; quantType?: string | null };
}

// Precision for safetensors is metadata.fp; GGUF quants carry metadata.quantType
// on the model endpoint only, so fall back to the quantType query param of the
// download URL (Civitai's own variant discriminator) when metadata lacks it.
export function civitFileVariant(file: VariantFile): string | null {
  if (file.metadata?.fp) return file.metadata.fp;
  if (file.metadata?.quantType) return file.metadata.quantType;
  try {
    return new URL(file.downloadUrl ?? "").searchParams.get("quantType");
  } catch {
    return null;
  }
}

// Dual-transformer bases publish each expert as its own version with the role
// named only in the version title; there is no structured field for it.
const DUAL_TRANSFORMER_ROLES: {
  base: RegExp;
  nameHint?: RegExp;
  roles: { suffix: string; words: string[] }[];
}[] = [
  {
    base: /^Wan Video 2\.2 .*A14B/i,
    roles: [
      { suffix: "high-noise", words: ["high"] },
      { suffix: "low-noise", words: ["low"] },
    ],
  },
  {
    // The conditional transformer is the primary and stays unsuffixed.
    // nameHint covers uploads tagged base "Other", which predate the
    // Ideogram 4.0 base tag on Civitai.
    base: /^Ideogram 4/i,
    nameHint: /ideogram\s*4/i,
    roles: [{ suffix: "uncond", words: ["uncond", "unconditional"] }],
  },
];

function splitWords(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .toLowerCase();
}

function hasWord(text: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`).test(text);
}

export interface RoleContext {
  name?: string | null;
  baseModel?: string | null;
  modelName?: string | null;
  // Roles resolved out-of-band (safetensors header peek), keyed by file id;
  // they take precedence over name-derived roles in civitFileSaveName.
  roles?: Map<number, string | null>;
}

function findArch(context: RoleContext) {
  return DUAL_TRANSFORMER_ROLES.find(
    (a) =>
      a.base.test(context.baseModel ?? "") ||
      (a.nameHint?.test(`${context.modelName ?? ""} ${context.name ?? ""}`) ?? false),
  );
}

export function civitFileRole(file: { name: string }, context: RoleContext): string | null {
  const arch = findArch(context);
  if (!arch) return null;
  const fileWords = splitWords(file.name);
  if (arch.roles.some((r) => r.words.some((w) => hasWord(fileWords, w)))) return null;
  const versionWords = splitWords(context.name ?? "");
  const match = arch.roles.find((r) => r.words.some((w) => hasWord(versionWords, w)));
  return match?.suffix ?? null;
}

// Header __metadata__ keys are tool-specific (model_type, modelspec.*), so
// scan every string value for role words.
export function civitRoleFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
  context: RoleContext,
): string | null {
  const arch = findArch(context);
  if (!arch || !metadata) return null;
  const text = splitWords(
    Object.values(metadata)
      .filter((v) => typeof v === "string")
      .join(" "),
  );
  const match = arch.roles.find((r) => r.words.some((w) => hasWord(text, w)));
  return match?.suffix ?? null;
}

// Every safetensors file of an open version gets probed; the backend caches
// by file id so repeats are free.
export function civitFilePeekTargets(files: VariantFile[]): VariantFile[] {
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
  F8_E4M3: "fp8",
  F8_E5M2: "fp8",
};

export function precisionFromDtype(dtype: string | null | undefined): string | null {
  return dtype ? (DTYPE_PRECISION[dtype] ?? null) : null;
}

// Civitai serves one canonical name for every variant of a version. Suffix
// unconditionally (not only on collision) so the name stays stable when a
// creator adds variants to a published version. Dual-transformer expert roles
// (name- or header-derived) join the variant, and remaining same-name
// collisions cascade to the size class, then the file id.
export function civitFileSaveName(
  file: VariantFile,
  siblings: VariantFile[],
  context?: RoleContext,
): string {
  const roleOf = (f: VariantFile) =>
    context ? (context.roles?.get(f.id) ?? civitFileRole(f, context)) : null;
  const tier1 = (f: VariantFile) => {
    const variant = civitFileVariant(f);
    const name = variant ? insertNameSuffix(f.name, variant) : f.name;
    const role = roleOf(f);
    return role ? insertNameSuffix(name, role) : name;
  };
  const tier2 = (f: VariantFile) =>
    f.metadata?.size ? insertNameSuffix(tier1(f), f.metadata.size) : tier1(f);
  const others = siblings.filter((s) => s.id !== file.id);
  const name = tier1(file);
  if (!others.some((s) => tier1(s) === name)) return name;
  const sized = tier2(file);
  if (!others.some((s) => tier2(s) === sized)) return sized;
  return insertNameSuffix(tier1(file), String(file.id));
}
