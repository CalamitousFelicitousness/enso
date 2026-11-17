// A job deleted from History is held while its step can be undone; the delete
// goes to the server when the step lets go. A page closed meanwhile keeps the job.

import { toast } from "sonner";
import { create } from "zustand";
import { api } from "@/api/client";
import { queryClient } from "@/api/queryClient";
import { DELETE_JOB_FAILED, JOB_DELETED } from "@/lib/jobs/text";
import { hold } from "@/undo/marks";

interface HeldDeletes {
  /** Jobs whose delete waits on its step; History leaves them out. */
  ids: ReadonlySet<string>;
}

export const useHeldDeletes = create<HeldDeletes>()(() => ({ ids: new Set() }));

function release(id: string): void {
  useHeldDeletes.setState((s) => {
    const ids = new Set(s.ids);
    ids.delete(id);
    return { ids };
  });
}

/** Hide a finished job as a held step; the server deletes it once the step lets go. */
export function deleteJobWithUndo(id: string): void {
  if (useHeldDeletes.getState().ids.has(id)) return;
  useHeldDeletes.setState((s) => ({ ids: new Set(s.ids).add(id) }));
  hold(
    "shared",
    { kind: "delete job" },
    {
      undo: () => release(id),
      commit: () => {
        api
          .delete(`/sdapi/v2/jobs/${id}`)
          .then(() => queryClient.invalidateQueries({ queryKey: ["v2-jobs"] }))
          .catch((err: unknown) => {
            toast.error(DELETE_JOB_FAILED, {
              description: err instanceof Error ? err.message : String(err),
            });
          })
          .finally(() => release(id));
      },
    },
  ).show(JOB_DELETED);
}
