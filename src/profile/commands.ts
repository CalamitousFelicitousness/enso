// The reset in the command palette, on every view.

import { ListRestart } from "lucide-react";
import { useRegisterCommand } from "@/lib/commandRegistry";
import { RESET_COMMAND, RESET_KEYWORDS } from "@/lib/profile/text";
import { useResetDialogStore } from "@/stores/resetDialogStore";

export function useProfileCommands(): void {
  useRegisterCommand({
    id: "profile:reset",
    label: RESET_COMMAND,
    group: "Actions",
    keywords: RESET_KEYWORDS,
    icon: ListRestart,
    run: () => useResetDialogStore.getState().openReset(),
  });
}
