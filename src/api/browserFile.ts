/** A gallery file's path on the server's gallery-confined route; load it through mediaUrl or useMediaSrc.
 * The listed mtime versions the URL, so a file written again at the path is not served from the HTTP cache. */
export function browserFilePath(fullPath: string, mtime: number | null = null): string {
  const path = `/sdapi/v2/browser/file?path=${encodeURIComponent(fullPath)}`;
  return mtime === null ? path : `${path}&v=${mtime}`;
}
