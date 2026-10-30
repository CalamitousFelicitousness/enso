// A job deleted from History is held while its Undo is offered; the delete goes
// to the server when the offer closes. A page closed meanwhile keeps the job.

import { toast } from "sonner";
import { create } from "zustand";
import { api } from "@/api/client";
import { queryClient } from "@/api/queryClient";
import { DELETE_JOB_FAILED, JOB_DELETED } from "@/lib/jobs/text";
import { OFFER_MS } from "@/lib/notices";

interface HeldDeletes {
  /** Jobs whose delete waits on its Undo; History leaves them out. */
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

/** Hide a finished job and offer Undo; the server deletes it once the offer closes. */
export function deleteJobWithUndo(id: string): void {
  if (useHeldDeletes.getState().ids.has(id)) return;
  useHeldDeletes.setState((s) => ({ ids: new Set(s.ids).add(id) }));
  let settled = false;
  const commit = () => {
    if (settled) return;
    settled = true;
    api
      .delete(`/sdapi/v2/jobs/${id}`)
      .then(() => queryClient.invalidateQueries({ queryKey: ["v2-jobs"] }))
      .catch((err: unknown) => {
        toast.error(DELETE_JOB_FAILED, {
          description: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => release(id));
  };
  toast(JOB_DELETED, {
    id: `job-delete-${id}`,
    duration: OFFER_MS,
    action: {
      label: "Undo",
      onClick: () => {
        settled = true;
        release(id);
      },
    },
    onDismiss: commit,
    onAutoClose: commit,
  });
}
