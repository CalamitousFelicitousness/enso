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

// Civitai serves one canonical name for every variant of a version; precision
// lives in metadata.fp. Suffix unconditionally (not only on collision) so the
// name stays stable when a creator adds variants to a published version.
// Same-fp collisions cascade to the size class, then the file id.
export function civitFileSaveName(
  file: { id: number; name: string; metadata?: { fp?: string | null; size?: string | null } },
  siblings: { id: number; name: string; metadata?: { fp?: string | null; size?: string | null } }[],
): string {
  type F = typeof file;
  const tier1 = (f: F) => (f.metadata?.fp ? insertNameSuffix(f.name, f.metadata.fp) : f.name);
  const tier2 = (f: F) =>
    f.metadata?.size ? insertNameSuffix(tier1(f), f.metadata.size) : tier1(f);
  const others = siblings.filter((s) => s.id !== file.id);
  const name = tier1(file);
  if (!others.some((s) => tier1(s) === name)) return name;
  const sized = tier2(file);
  if (!others.some((s) => tier2(s) === sized)) return sized;
  return insertNameSuffix(tier1(file), String(file.id));
}
