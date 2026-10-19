import { useRestoreDialogStore } from "@/stores/restoreDialogStore";
import { GenerationDiffDialog } from "./GenerationDiffDialog";

/** The Restore dialog, mounted once: the strip, the Output dock and the
 * Action Bar open it, with the Left Panel collapsed too. */
export function RestoreDialogHost() {
  const target = useRestoreDialogStore((s) => s.target);
  const close = useRestoreDialogStore((s) => s.close);
  return (
    <GenerationDiffDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      source={target}
    />
  );
}
