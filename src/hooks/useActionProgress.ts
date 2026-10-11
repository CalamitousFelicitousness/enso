import { useSubmitProgress } from "@/inputs/progress";
import { uploadView, type SubmitProgress, type UploadView } from "@/lib/media/progress";

/** What a slot shows of its action's run: re-rendered only when the value
 * `select` picks from the run's progress changes. */
export function useActionProgress<T>(
  action: string,
  select: (entry: SubmitProgress | undefined) => T,
): T {
  return useSubmitProgress((s) => select(s.byAction[action]));
}

/** The action's upload as a slot shows it; null while none runs. */
export function useUploadView(action: string): UploadView | null {
  return uploadView(useActionProgress(action, (e) => e));
}
