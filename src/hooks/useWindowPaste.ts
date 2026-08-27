import { useEffect, useEffectEvent } from "react";

/**
 * Paste image files into a view without the view holding focus.
 *
 * `inert` does not block window-level events, so a hidden KeepAlive panel
 * keeps receiving pastes meant for the active view; pass the panel's
 * visibility as `enabled`. Typing targets are skipped, and `onFiles` is
 * called only with a non-empty list.
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
      for (const item of items) {
        if (!item.type.startsWith("image/")) continue;
        const file = item.getAsFile();
        if (file) files.push(file);
      }
      if (files.length > 0) emit(files);
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [enabled]);
}
