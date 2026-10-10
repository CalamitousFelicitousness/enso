import { useCallback, useState } from "react";
import { mediaSrc, renewAfterFailure, useSessionStore } from "@/api/session";

export interface MediaSrc {
  /** undefined while the session is not known yet, so nothing loads without it. */
  src: string | undefined;
  onError: () => void;
  /** The load failed and loading it again cannot help until the session changes. */
  failed: boolean;
}

interface Attempt {
  image: string;
  /** The session epoch this attempt loads under. */
  epoch: number;
  /** Attempts before this one; a retry carries the count as a fragment, so the element loads again. */
  retries: number;
  phase: "loading" | "renewing" | "failed";
}

/** src and onError for an <img> or <video> showing a server file (or a data:, blob: or base64 image).
 * A server file the browser could not load asks for a fresh session, and a failed load is tried again
 * whenever the session changes; the fragment changes the attribute, never the URL or the cache entry. */
export function useMediaSrc(image: string | null | undefined): MediaSrc {
  const pending = useSessionStore((s) => s.mode === "pending");
  const epoch = useSessionStore((s) => s.epoch);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  // Adjusted while rendering rather than in an effect, so no frame shows a stale attempt
  if (image && attempt?.image !== image) {
    setAttempt({ image, epoch, retries: 0, phase: "loading" });
  } else if (image && attempt && attempt.phase !== "loading" && epoch > attempt.epoch) {
    setAttempt({ ...attempt, epoch, retries: attempt.retries + 1, phase: "loading" });
  }
  const live = image && attempt?.image === image ? attempt : null;

  const onError = useCallback(() => {
    if (live?.phase !== "loading") return;
    if (!live.image.startsWith("/") && !/^https?:/.test(live.image)) {
      setAttempt({ ...live, phase: "failed" });
      return;
    }
    setAttempt({ ...live, phase: "renewing" });
    // A renewal advances the epoch, which retries above; without one this load has failed
    void renewAfterFailure(live.epoch).then((renewed) => {
      if (renewed) return;
      setAttempt((current) =>
        current?.image === live.image && current.retries === live.retries
          ? { ...current, phase: "failed" }
          : current,
      );
    });
  }, [live]);

  if (!image || pending) return { src: undefined, onError, failed: false };
  const src = mediaSrc(image);
  return {
    src: live?.retries ? `${src}#r${live.retries}` : src,
    onError,
    failed: live?.phase === "failed",
  };
}
