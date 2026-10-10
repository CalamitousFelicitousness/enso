/** A gallery file's path on the server's gallery-confined route; load it through mediaUrl or useMediaSrc. */
export function browserFilePath(fullPath: string): string {
  return `/sdapi/v2/browser/file?path=${encodeURIComponent(fullPath)}`;
}
