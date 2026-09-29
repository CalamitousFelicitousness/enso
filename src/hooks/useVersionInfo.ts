import { useQuery } from "@tanstack/react-query";
import { useServerInfo } from "@/api/hooks/useServer";

export type VersionSyncState = "in-sync" | "reload-needed" | "dist-stale" | "dev" | "unknown";

const POLL_MS = 5 * 60 * 1000;

export interface VersionInfo {
  bundleSha: string;
  bundleShort: string;
  /** ISO date (YYYY-MM-DD) the bundle was built */
  bundleDate: string;
  bundleSource: "release" | "local" | "dev";
  backendCommit: string | null;
  backendShort: string | null;
  distSource: "release" | "local" | "unknown" | null;
  /** When dist/ was last read, as a timestamp; 0 before the first read */
  distCheckedAt: number;
  syncState: VersionSyncState;
}

/** Build sha of the frontend in dist/ right now, from version.json on the page's own origin. */
async function fetchDistBuild(): Promise<string | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`version.json: HTTP ${res.status}`);
  const dist = (await res.json()) as { sha?: string };
  return dist.sha ?? null;
}

/**
 * Compares the running bundle's baked commit against the build in dist/ and
 * the extension checkout reported by the backend. "reload-needed" means dist/
 * holds a different build than this tab runs; "dist-stale" means dist/ itself
 * was built from a different commit than the installed extension.
 */
export function useVersionInfo(): VersionInfo {
  const { data } = useServerInfo();
  const ext = data?.extension;
  const backendCommit = ext?.commit ?? null;
  // Keyed on the checkout so a new checkout rereads dist/ before the two are compared
  const dist = useQuery({
    queryKey: ["frontend-build", backendCommit],
    queryFn: fetchDistBuild,
    enabled: __ENSO_BUILD__.source !== "dev",
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });

  let syncState: VersionSyncState;
  if (__ENSO_BUILD__.source === "dev") syncState = "dev";
  else if (dist.data && dist.data !== __ENSO_BUILD__.sha) syncState = "reload-needed";
  else if (!backendCommit) syncState = "unknown";
  else if (backendCommit === __ENSO_BUILD__.sha) syncState = "in-sync";
  // Until dist/ is read, a stale tab and a stale dist/ look alike
  else if (dist.isPending) syncState = "unknown";
  else syncState = "dist-stale";

  return {
    bundleSha: __ENSO_BUILD__.sha,
    bundleShort: __ENSO_BUILD__.sha.slice(0, 7),
    bundleDate: __ENSO_BUILD__.time.slice(0, 10),
    bundleSource: __ENSO_BUILD__.source,
    backendCommit,
    backendShort: backendCommit ? backendCommit.slice(0, 7) : null,
    distSource: ext?.dist_source ?? null,
    distCheckedAt: dist.dataUpdatedAt,
    syncState,
  };
}
