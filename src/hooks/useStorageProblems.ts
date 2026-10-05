import { useEffect } from "react";
import { toast } from "sonner";
import { onStorageProblem } from "@/lib/storageHealth";

/** Says so when a persisted store cannot read or write its record, since the
 * page otherwise looks normal while nothing is being saved. */
export function useStorageProblems() {
  useEffect(
    () =>
      onStorageProblem((problem) => {
        const id = `storage-${problem.id}`;
        if (problem.kind === "resolved") {
          toast.dismiss(id);
          return;
        }
        if (problem.kind === "write") {
          toast.error(`Changes to ${problem.what} are not being saved`, {
            id,
            description:
              problem.reason ?? "The browser refused to store them; its storage may be full.",
            duration: Infinity,
          });
          return;
        }
        if (problem.kind === "conflict") {
          toast.error(`The ${problem.what} were changed in another tab`, {
            id,
            description:
              "This tab shows an older version and is not saving. Load the saved one, or keep this tab's and replace it.",
            duration: Infinity,
            // kept up until the load succeeds, as for Retry below
            action: {
              label: "Load saved",
              onClick: (event) => {
                event.preventDefault();
                problem.useStored();
              },
            },
            cancel: { label: "Keep this tab's", onClick: problem.keepMine },
          });
          return;
        }
        toast.error(`Saved ${problem.what} could not be loaded`, {
          id,
          description: problem.newer
            ? "A newer version of Enso saved them. They are kept as they are and nothing is being saved; start empty to replace them."
            : "Nothing is being saved. Retry, or start empty to replace what was stored.",
          duration: Infinity,
          // Stays up until a read succeeds: sonner would otherwise remove it on
          // the click, and with it the report of a retry that failed again.
          action: {
            label: "Retry",
            onClick: (event) => {
              event.preventDefault();
              problem.retry();
            },
          },
          cancel: { label: "Start empty", onClick: problem.startEmpty },
        });
      }),
    [],
  );
}
