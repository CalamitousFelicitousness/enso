import { useCallback, useState } from "react";
import { toast } from "sonner";
import { submitJob, type Submission } from "@/inputs/jobs";
import { UserAbortError } from "@/lib/abort";

interface SubmitOptions {
  build: () => Promise<Submission>;
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
