import { useServerInfo } from "@/api/hooks/useServer";

export type VersionSyncState = "in-sync" | "dist-stale" | "dev" | "unknown";

export interface VersionInfo {
  bundleSha: string;
  bundleShort: string;
  /** ISO date (YYYY-MM-DD) the bundle was built */
  bundleDate: string;
  bundleSource: "release" | "local" | "dev";
  backendCommit: string | null;
  backendShort: string | null;
  distSource: "release" | "local" | "unknown" | null;
  syncState: VersionSyncState;
}

/**
 * Compares the running bundle's baked commit against the extension checkout
 * reported by the backend. "dist-stale" means the served frontend was built
 * from a different commit than the installed extension.
 */
export function useVersionInfo(): VersionInfo {
  const { data } = useServerInfo();
  const ext = data?.extension;
  const backendCommit = ext?.commit ?? null;

  let syncState: VersionSyncState;
  if (__ENSO_BUILD__.source === "dev") syncState = "dev";
  else if (!backendCommit) syncState = "unknown";
  else syncState = backendCommit === __ENSO_BUILD__.sha ? "in-sync" : "dist-stale";

  return {
    bundleSha: __ENSO_BUILD__.sha,
    bundleShort: __ENSO_BUILD__.sha.slice(0, 7),
    bundleDate: __ENSO_BUILD__.time.slice(0, 10),
    bundleSource: __ENSO_BUILD__.source,
    backendCommit,
    backendShort: backendCommit ? backendCommit.slice(0, 7) : null,
    distSource: ext?.dist_source ?? null,
    syncState,
  };
}
