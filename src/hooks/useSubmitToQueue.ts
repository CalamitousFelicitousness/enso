import { useCallback, useState } from "react";
import { toast } from "sonner";
import { submitJob, type Submission } from "@/inputs/jobs";

interface SubmitOptions {
  build: () => Promise<Submission>;
}

/** Throw from a build implementation to cancel cleanly without a generic
 * "Failed to submit job" toast. The caller is expected to have already
 * surfaced a guidance message (e.g. via toast.warning) before throwing this.
 * Used by ActionBar to refuse local-video models on the Images view path. */
export class UserAbortError extends Error {
  override name = "UserAbortError";
}

export function useSubmitToQueue({ build }: SubmitOptions) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await submitJob(await build());
    } catch (err) {
      if (err instanceof UserAbortError) return;
      toast.error("Failed to submit job", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [build]);

  return { submit, isSubmitting };
}
