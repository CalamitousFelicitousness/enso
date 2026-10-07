import { useEffect } from "react";
import { toast } from "sonner";
import { reportLines } from "@/lib/inputs/report";
import { outlineEntry } from "@/lib/inputs/outline";
import { outlineOf } from "@/inputs/useOutline";
import { startSizeSync } from "@/inputs/sizeSync";
import { useCapacitySync } from "@/inputs/capacity";
import { runUndo } from "@/inputs/undo";
import { useShortcut } from "@/hooks/useShortcut";
import { useInputStore } from "@/stores/inputStore";

/** Tells the user what loading the stored inputs turned up, and offers to
 * bring in inputs an older build saved after the first import. Also starts
 * the size sync, which waits for the same load, keeps the model's image
 * limit on the store, and runs the pending undo on Ctrl+Z. */
export function useInputNotices() {
  const report = useInputStore((s) => s.report);
  const offers = useInputStore((s) => s.offers);

  useEffect(() => startSizeSync(), []);
  useCapacitySync();
  useShortcut("undo", () => void runUndo());

  useEffect(() => {
    if (!report) return;
    const { frames, dismissReport } = useInputStore.getState();
    const outline = outlineOf(frames);
    const lines = reportLines(report, (id) => outlineEntry(outline, id)?.position ?? null);
    toast.warning("About your stored inputs", {
      // the same lines are one notice, however often the effect runs
      id: `inputs-report:${lines.join("|")}`,
      description: (
        <ul className="list-disc space-y-1 pl-4">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ),
      duration: Infinity,
      closeButton: true,
    });
    dismissReport();
  }, [report]);

  useEffect(() => {
    const { acceptImport, declineImport } = useInputStore.getState();
    for (const offer of offers) {
      toast("An earlier version of Enso saved other inputs", {
        id: `inputs-offer-${offer.id}`,
        description: "Import adds them as extra input frames. Nothing you have here is replaced.",
        duration: Infinity,
        action: { label: "Import", onClick: () => void acceptImport(offer) },
        cancel: { label: "Dismiss", onClick: () => declineImport(offer) },
      });
    }
  }, [offers]);
}
