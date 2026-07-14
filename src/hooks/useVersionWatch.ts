import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useVersionInfo } from "./useVersionInfo";

const POLL_MS = 5 * 60 * 1000;

/**
 * Surfaces the two staleness modes as toasts:
 * - dist-stale: the served frontend predates the extension checkout; fixed
 *   server-side (restart fetches the matching build), warned once per session.
 * - reload-needed: a newer build landed in dist/ under a long-running tab;
 *   detected by polling version.json, fixed by reloading.
 */
export function useVersionWatch() {
  const { syncState, backendShort, bundleShort } = useVersionInfo();
  const warned = useRef(false);

  useEffect(() => {
    if (syncState !== "dist-stale" || warned.current) return;
    warned.current = true;
    toast.warning("Frontend build is out of date", {
      description: `The UI was built from ${bundleShort} but the installed extension is at ${backendShort ?? "unknown"}. Restart SD.Next to fetch the matching build.`,
      duration: 12_000,
    });
  }, [syncState, backendShort, bundleShort]);

  useEffect(() => {
    if (__ENSO_BUILD__.source === "dev") return;
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: "no-store" });
        if (!res.ok) return;
        const disk = (await res.json()) as { sha?: string };
        if (!cancelled && disk.sha && disk.sha !== __ENSO_BUILD__.sha) {
          toast.info("A new frontend build is available", {
            id: "enso-reload-prompt",
            description: "Reload to switch to the updated UI.",
            duration: Infinity,
            action: { label: "Reload", onClick: () => window.location.reload() },
          });
        }
      } catch {
        // offline or backend restarting; the next tick retries
      }
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, POLL_MS);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
}
