/** Lightweight cursor-position store for the prompt field.
 *  PromptField saves position on blur; network insertion code reads it. */

let pos: number | null = null;

export function setPromptCursor(position: number) {
  pos = position;
}

export function getPromptCursor(): number | null {
  return pos;
}

/** Insert text at the last known cursor position (or end if unknown). */
export function insertAtCursor(current: string, text: string): string {
  const at = pos ?? current.length;
  const before = current.slice(0, at);
  const after = current.slice(at);
  // Add spacing if needed
  const needsLeadingSpace = before.length > 0 && !before.endsWith(" ");
  const needsTrailingSpace = after.length > 0 && !after.startsWith(" ");
  return (
    before +
    (needsLeadingSpace ? " " : "") +
    text +
    (needsTrailingSpace ? " " : "") +
    after
  );
}
