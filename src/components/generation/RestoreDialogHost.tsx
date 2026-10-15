import { useGenerationStore } from "@/stores/generationStore";
import { useRestoreDialogStore } from "@/stores/restoreDialogStore";
import { GenerationDiffDialog } from "./GenerationDiffDialog";

/** The strip's Restore dialog, mounted once: the Output dock opens it with
 * the Left Panel collapsed too. */
export function RestoreDialogHost() {
  const target = useRestoreDialogStore((s) => s.target);
  const close = useRestoreDialogStore((s) => s.close);
  const result = useGenerationStore((s) =>
    target ? (s.results.find((r) => r.id === target.resultId) ?? null) : null,
  );
  return (
    <GenerationDiffDialog
      open={result !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      result={result}
      imageIndex={target?.imageIndex ?? 0}
    />
  );
}
