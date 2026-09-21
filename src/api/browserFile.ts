import { api } from "./client";

/** Full-size gallery file URL, served by the backend's gallery-confined route. */
export function browserFileUrl(fullPath: string): string {
  return `${api.getBaseUrl()}/sdapi/v2/browser/file?path=${encodeURIComponent(fullPath)}`;
}
