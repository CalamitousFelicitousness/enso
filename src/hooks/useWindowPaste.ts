import { useEffect, useEffectEvent } from "react";
import { toast } from "sonner";
import { nothingUsedText } from "@/lib/recipes/text";

/**
 * Paste image files into a view without the view holding focus.
 *
 * `inert` does not block window-level events, so a hidden KeepAlive panel
 * keeps receiving pastes meant for the active view; pass the panel's
 * visibility as `enabled`. Typing targets are skipped, `onFiles` is called
 * only with a non-empty list, and a paste of files that are not pictures is said.
 */
export function useWindowPaste(onFiles: (files: File[]) => void, enabled = true) {
  const emit = useEffectEvent(onFiles);

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      )
        return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      let refused = 0;
      for (const item of items) {
        if (item.kind !== "file") continue;
        if (!item.type.startsWith("image/")) {
          refused++;
          continue;
        }
        const file = item.getAsFile();
        if (file) files.push(file);
      }
      if (files.length > 0) emit(files);
      else if (refused > 0) toast.info(nothingUsedText("paste", "pictures"));
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [enabled]);
}
