import { useCallback, useState } from "react";
import { runAction, type ActionSettings, type RunContext, type RunOptions } from "@/inputs/action";
import { cancelAction } from "@/inputs/progress";
import { UPLOAD_FAILED, UPLOAD_STOPPED } from "@/lib/media/text";

/** An action a view starts that sends bytes; `busy` while a run of this
 * component's is in flight, `cancel` stops the action's current run,
 * whichever component started it. */
export function useUploadAction(action: string, settings: Partial<ActionSettings> = {}) {
  const { transient = false, cancelled = UPLOAD_STOPPED, failed = UPLOAD_FAILED } = settings;
  const [running, setRunning] = useState(0);

  const run = useCallback(
    async <T>(work: (ctx: RunContext) => Promise<T>, options?: RunOptions): Promise<T | null> => {
      setRunning((n) => n + 1);
      try {
        return await runAction(action, work, { transient, cancelled, failed }, options);
      } finally {
        setRunning((n) => n - 1);
      }
    },
    [action, transient, cancelled, failed],
  );

  const cancel = useCallback(() => cancelAction(action), [action]);

  return { run, busy: running > 0, cancel };
}
