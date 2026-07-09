// Browse links open on the civitai.red mirror; API requests stay on civitai.com.
export const CIVITAI_SITE = "https://civitai.red";

export function civitaiModelUrl(modelId: number, versionId?: number): string {
  return `${CIVITAI_SITE}/models/${modelId}${versionId ? `?modelVersionId=${versionId}` : ""}`;
}

export function civitaiUserUrl(username: string): string {
  return `${CIVITAI_SITE}/user/${encodeURIComponent(username)}`;
}
