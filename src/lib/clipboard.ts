import { toast } from "sonner";

/** Copies text to the clipboard; on failure shows why and resolves false. */
export async function copyText(text: string): Promise<boolean> {
  // navigator.clipboard exists only in a secure context (https or localhost).
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // A refusal (unfocused page, permission) falls back to the selection copy.
    }
  }
  if (copyBySelection(text)) return true;
  toast.error("Could not copy", { description: "The browser refused access to the clipboard." });
  return false;
}

/** Reads text from the clipboard; on failure shows why and resolves null. */
export async function pasteText(): Promise<string | null> {
  // A page cannot read the clipboard outside a secure context; there is no fallback.
  if (!navigator.clipboard) {
    toast.error("Could not paste", {
      description: "Reading the clipboard needs the page opened over https or on localhost.",
    });
    return null;
  }
  try {
    return await navigator.clipboard.readText();
  } catch {
    toast.error("Could not paste", { description: "The browser refused access to the clipboard." });
    return null;
  }
}

function copyBySelection(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.readOnly = true;
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.opacity = "0";
  // Beside the focused element, so an open dialog's or menu's focus trap keeps the selection.
  const focused = document.activeElement;
  const host =
    focused instanceof HTMLElement && focused !== document.body ? focused.parentElement : null;
  (host ?? document.body).append(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
  }
}
