import { useCallback, useEffect, useRef, useState } from "react";
import { recorded } from "@/undo/marks";

/**
 * A text field over a value that is parsed on write: it edits a draft while
 * focused and commits it on blur, or on unmount when blur never came. Spread
 * the result on an Input or Textarea.
 */
export function useDraftText(value: string, onCommit: (text: string) => void) {
  const [draft, setDraft] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const latest = useRef({ value, onCommit });
  useEffect(() => {
    latest.current = { value, onCommit };
  });

  const commit = useCallback(() => {
    const text = pending.current;
    pending.current = null;
    if (text !== null && text !== latest.current.value) latest.current.onCommit(text);
  }, []);
  // an unmount can come from a render no input event caused
  useEffect(
    () => () => {
      recorded(commit);
    },
    [commit],
  );

  return {
    value: draft ?? value,
    onFocus: () => {
      pending.current = value;
      setDraft(value);
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      pending.current = e.target.value;
      setDraft(e.target.value);
    },
    onBlur: () => {
      commit();
      setDraft(null);
    },
  };
}
