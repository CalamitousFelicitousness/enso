import { useEffect } from "react";
import { toast } from "sonner";
import { onStorageProblem } from "@/lib/storageHealth";
import { aboutSize } from "@/lib/inputs/text";
import { alone, reclaimableBytes } from "@/inputs/db";
import { showLibrary } from "@/inputs/library";
import { FULL_ID } from "@/inputs/quota";
import { useTrash } from "@/inputs/trash";

let fullShown = false;

/** What the origin's storage holds of what the browser allows it. */
async function usageText(): Promise<string> {
  const estimate = await navigator.storage?.estimate?.().catch(() => null);
  if (!estimate?.usage || !estimate.quota) return "";
  return ` Enso holds ${aboutSize(estimate.usage)} of the ${aboutSize(estimate.quota).replace("about ", "")} this browser allows it.`;
}

/** Storage is full: say what could not be stored, and offer the trash when
 * emptying it frees space now, else say where space can be freed. Worked out
 * once per episode. */
async function showFull(what: string): Promise<void> {
  if (fullShown) return;
  fullShown = true;
  const [bytes, onlyTab] = await Promise.all([
    reclaimableBytes().catch(() => 0),
    alone().catch(() => false),
  ]);
  const base = `${what} could not be stored.`;
  if (bytes > 0 && onlyTab) {
    toast.error("Storage is full", {
      id: FULL_ID,
      description: `${base} Emptying the trash frees ${aboutSize(bytes)}.`,
      duration: Infinity,
      action: {
        label: "Free space",
        onClick: () => {
          showLibrary("trash");
          useTrash.setState({ askEmpty: true });
        },
      },
    });
    return;
  }
  const trash =
    bytes > 0
      ? ` Close the other Enso tabs and empty the trash to free ${aboutSize(bytes)}.`
      : " Remove saved inputs from the Library, or keep fewer results on the strip.";
  toast.error("Storage is full", {
    id: FULL_ID,
    description: `${base}${await usageText()}${trash}`,
    duration: Infinity,
  });
}

/** Says so when a persisted store cannot read or write its record, since the
 * page otherwise looks normal while nothing is being saved. */
export function useStorageProblems() {
  useEffect(
    () =>
      onStorageProblem((problem) => {
        const id = `storage-${problem.id}`;
        if (problem.kind === "resolved") {
          toast.dismiss(problem.id === FULL_ID ? FULL_ID : id);
          if (problem.id === FULL_ID) fullShown = false;
          return;
        }
        if (problem.kind === "full") {
          void showFull(problem.what);
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
