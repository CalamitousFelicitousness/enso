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

// Civitai serves one canonical name for every variant of a version. Suffix
// unconditionally (not only on collision) so the name stays stable when a
// creator adds variants to a published version. Same-variant collisions
// cascade to the size class, then the file id.
export function civitFileSaveName(file: VariantFile, siblings: VariantFile[]): string {
  const tier1 = (f: VariantFile) => {
    const variant = civitFileVariant(f);
    return variant ? insertNameSuffix(f.name, variant) : f.name;
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
