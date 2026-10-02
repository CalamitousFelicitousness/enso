import { Info } from "lucide-react";

/** Inline note under a control: how the loaded model changes what it does. */
export function ParamNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-1.5 rounded border border-border/40 bg-muted/30 px-2 py-1.5 text-3xs text-muted-foreground">
      <Info size={11} className="mt-px shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/** Text-styled action inside a ParamNotice. */
export function ParamNoticeAction({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid"
    >
      {children}
    </button>
  );
}
