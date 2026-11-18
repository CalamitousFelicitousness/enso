// Undo and Redo from the keys, the command palette and native text fields,
// mounted once in AppShell.

import { useEffect } from "react";
import { Redo2, Undo2 } from "lucide-react";
import { useShortcut } from "@/hooks/useShortcut";
import { useRegisterCommand } from "@/lib/commandRegistry";
import { routeTextFields } from "./editors";
import { pressUndo } from "./press";

export function useUndoCommands(): void {
  useShortcut("undo", () => pressUndo("undo"));
  useShortcut("redo", () => pressUndo("redo"));
  useShortcut("redo-alt", () => pressUndo("redo"));
  useEffect(() => routeTextFields(), []);
  useRegisterCommand({
    id: "actions:undo",
    label: "Undo the last change",
    group: "Actions",
    keywords: ["undo", "revert", "bring back", "removed", "step back"],
    icon: Undo2,
    shortcutId: "undo",
    run: () => {
      pressUndo("undo");
    },
  });
  useRegisterCommand({
    id: "actions:redo",
    label: "Redo the last undone change",
    group: "Actions",
    keywords: ["redo", "again", "forward", "reapply"],
    icon: Redo2,
    shortcutId: "redo",
    run: () => {
      pressUndo("redo");
    },
  });
}
