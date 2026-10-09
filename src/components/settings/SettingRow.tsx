import { useRef, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

export function SettingRow({
  label,
  description,
  tooltip,
  inline,
  children,
}: {
  label: string;
  description?: string;
  tooltip?: string;
  inline?: boolean;
  children: React.ReactNode;
}) {
  const labelText = tooltip ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-xs font-medium cursor-help">{label}</span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  ) : (
    <span className="text-xs font-medium">{label}</span>
  );

  const labelBlock = (
    <div className="flex flex-col gap-0.5">
      {labelText}
      {description && (
        <span className="text-3xs text-muted-foreground leading-tight">{description}</span>
      )}
    </div>
  );

  if (inline) {
    return (
      <div className="flex items-center justify-between gap-3 group">
        {labelBlock}
        {children}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {labelBlock}
      {children}
    </div>
  );
}

interface CommittedSliderRowProps {
  label: string;
  tooltip?: string;
  /** The value in effect. */
  value: number;
  min: number;
  max: number;
  step?: number;
  /** The value as shown beside the slider. */
  format?: (value: number) => string;
  /** The line under the label for the value shown: the one in effect, or the
   * one the pointer is dragging to, so it can say what committing would do. */
  describe: (shown: number) => string;
  onCommit: (value: number) => void;
}

/** A setting on a slider that takes effect when the value is committed: on
 * release, or at each key step. */
export function CommittedSliderRow({
  label,
  tooltip,
  value,
  min,
  max,
  step = 1,
  format = String,
  describe,
  onCommit,
}: CommittedSliderRowProps) {
  // Only a pointer drag shows a value before it commits. A key commits each
  // step, and Radix reports the change after the commit.
  const dragging = useRef(false);
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;

  return (
    <SettingRow label={label} description={describe(shown)} {...(tooltip ? { tooltip } : {})}>
      <div className="flex items-center gap-2 flex-1">
        <Slider
          min={min}
          max={max}
          step={step}
          value={[shown]}
          onPointerDown={() => {
            dragging.current = true;
          }}
          onLostPointerCapture={() => {
            dragging.current = false;
            setDraft(null);
          }}
          onValueChange={([v]) => {
            if (dragging.current) setDraft(v);
          }}
          onValueCommit={([v]) => {
            setDraft(null);
            onCommit(v);
          }}
          aria-label={label}
          className="flex-1"
        />
        <span className="text-xs text-muted-foreground font-mono tabular-nums w-14 text-right">
          {format(shown)}
        </span>
      </div>
    </SettingRow>
  );
}
