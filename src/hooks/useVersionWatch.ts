import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useVersionInfo } from "./useVersionInfo";

/**
 * Surfaces the two staleness modes as toasts:
 * - reload-needed: a different build landed in dist/ under a long-running tab,
 *   as a server update leaves it; fixed by reloading. Prompted again on every
 *   read of dist/ that still finds it.
 * - dist-stale: the served frontend predates the extension checkout; fixed
 *   server-side (restart fetches the matching build), warned once per session.
 */
export function useVersionWatch() {
  const { syncState, backendShort, bundleShort, distCheckedAt } = useVersionInfo();
  const warned = useRef(false);

  useEffect(() => {
    if (syncState !== "reload-needed") return;
    toast.info("A new frontend build is available", {
      id: "enso-reload-prompt",
      description:
        "Reload to switch to the updated UI. Jobs sent from this page may be refused until then.",
      duration: Infinity,
      action: { label: "Reload", onClick: () => window.location.reload() },
    });
  }, [syncState, distCheckedAt]);

  useEffect(() => {
    if (syncState !== "dist-stale" || warned.current) return;
    warned.current = true;
    toast.warning("Frontend build is out of date", {
      description: `The UI was built from ${bundleShort} but the installed extension is at ${backendShort ?? "unknown"}. Restart SD.Next to fetch the matching build.`,
      duration: 12_000,
    });
  }, [syncState, backendShort, bundleShort]);
}
