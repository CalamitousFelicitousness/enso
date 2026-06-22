import { type ReactNode } from "react";
import { useGenerationStore } from "@/stores/generationStore";
import { usePromptHistoryStore, type PromptHistoryEntry } from "@/stores/promptHistoryStore";
import { CalendarClock, Star, Copy, ClipboardPaste, X, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** How many unpinned entries the Recent section shows at once. */
const RECENT_LIMIT = 12;

const TIP_LABEL = "mb-0.5 text-3xs uppercase tracking-wider text-muted-foreground/70";
const TIP_VALUE = "whitespace-pre-wrap break-words font-mono text-xs leading-relaxed";
const TIP_VALUE_NEG = `${TIP_VALUE} text-muted-foreground`;
const TIP_META = "pt-0.5 text-2xs text-muted-foreground/60";

interface PromptHistoryPopoverProps {
  /** Closes the surrounding popover after a restore action. */
  onClose: () => void;
}

export function PromptHistoryPopover({ onClose }: PromptHistoryPopoverProps) {
  const history = usePromptHistoryStore((s) => s.history);
  const togglePin = usePromptHistoryStore((s) => s.togglePin);
  const remove = usePromptHistoryStore((s) => s.remove);
  const clear = usePromptHistoryStore((s) => s.clear);
  const setParam = useGenerationStore((s) => s.setParam);

  const pinned = history.filter((h) => h.pinned);
  const recent = history.filter((h) => !h.pinned).slice(0, RECENT_LIMIT);

  function restore(h: PromptHistoryEntry) {
    setParam("prompt", h.prompt);
    onClose();
  }

  function restoreAll(h: PromptHistoryEntry) {
    setParam("prompt", h.prompt);
    setParam("negativePrompt", h.negative);
    setParam("steps", h.steps);
    setParam("width", h.width);
    setParam("height", h.height);
    onClose();
  }

  function copy(h: PromptHistoryEntry) {
    void navigator.clipboard?.writeText(h.prompt);
    toast.success("Copied to clipboard");
  }

  const Row = (h: PromptHistoryEntry) => {
    const meta = [h.model, `${h.width}×${h.height}`, `${h.steps} steps`]
      .filter(Boolean)
      .join(" · ");
    return (
      <div
        key={h.id}
        className={cn(
          "group relative flex items-start gap-2 rounded px-2 py-1.5 transition-colors hover:bg-primary/10",
          h.pinned && "bg-primary/[0.06]",
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => restore(h)}
              className="min-w-0 flex-1 line-clamp-2 cursor-pointer border-0 bg-transparent p-0 text-left font-mono text-xs leading-snug text-foreground transition-colors hover:text-primary"
            >
              {h.prompt}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" align="start" className="max-w-md">
            <div className="flex flex-col gap-1.5">
              <div>
                <div className={TIP_LABEL}>Prompt</div>
                <div className={TIP_VALUE}>{h.prompt}</div>
              </div>
              {h.negative && (
                <div>
                  <div className={TIP_LABEL}>Negative</div>
                  <div className={TIP_VALUE_NEG}>{h.negative}</div>
                </div>
              )}
              {meta && <div className={TIP_META}>{meta}</div>}
            </div>
          </TooltipContent>
        </Tooltip>
        <div
          className={cn(
            "flex shrink-0 gap-px opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
            h.pinned && "opacity-100",
          )}
        >
          <IconButton
            label={h.pinned ? "Unpin" : "Pin to top"}
            onClick={() => togglePin(h.id)}
            className={h.pinned ? "text-primary" : undefined}
          >
            <Star size={14} className={h.pinned ? "fill-current" : undefined} />
          </IconButton>
          <IconButton label="Copy prompt" onClick={() => copy(h)}>
            <Copy size={14} />
          </IconButton>
          <IconButton label="Restore prompt, negative & size" onClick={() => restoreAll(h)}>
            <ClipboardPaste size={14} />
          </IconButton>
          <IconButton
            label="Remove from history"
            onClick={() => remove(h.id)}
            className="hover:text-destructive"
          >
            <X size={14} />
          </IconButton>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-2.5 py-2">
        <div className="flex items-center gap-1.5 text-xs text-foreground">
          <CalendarClock size={14} className="text-primary" />
          Prompt history
          <span className="font-mono text-2xs text-muted-foreground">{history.length}</span>
        </div>
        {history.length > 0 && (
          <button
            type="button"
            onClick={clear}
            title="Clear history (keeps pinned)"
            className="flex items-center gap-1 rounded px-1.5 py-1 text-2xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 size={12} />
            Clear all
          </button>
        )}
      </div>

      {/* List */}
      <div className="flex max-h-[19rem] flex-col gap-1 overflow-y-auto overflow-x-hidden p-1.5">
        {history.length === 0 && (
          <div className="px-3.5 py-6 text-center font-mono text-xs leading-relaxed text-muted-foreground/70">
            No prompts yet.
            <br />
            Prompts you Generate with land here.
          </div>
        )}

        {pinned.length > 0 && (
          <>
            <SectionHeader>
              <Star size={11} className="text-primary" />
              Pinned
            </SectionHeader>
            {pinned.map(Row)}
          </>
        )}

        {recent.length > 0 && (
          <>
            {pinned.length > 0 && <SectionHeader>Recent</SectionHeader>}
            {recent.map(Row)}
          </>
        )}
      </div>

      {/* Footer */}
      {history.length > 0 && (
        <div className="flex items-center justify-between gap-2 border-t border-border/50 px-2.5 py-1.5 font-mono text-2xs text-muted-foreground">
          <span>
            {recent.length} recent
            {pinned.length ? ` · ${pinned.length} pinned` : ""}
          </span>
          <span className="text-muted-foreground/60">click restores · ⧉ restores all</span>
        </div>
      )}
    </div>
  );
}

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 px-1.5 pb-0.5 pt-1.5 text-3xs uppercase tracking-wider text-muted-foreground/70">
      {children}
      <span className="h-px flex-1 bg-border/60" />
    </div>
  );
}

interface IconButtonProps {
  label: string;
  onClick: () => void;
  className?: string | undefined;
  children: ReactNode;
}

function IconButton({ label, onClick, className, children }: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "flex size-[1.4rem] shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-primary",
        className,
      )}
    >
      {children}
    </button>
  );
}
