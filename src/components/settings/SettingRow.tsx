import { useCommittedSlider } from "@/hooks/useCommittedSlider";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function SettingRow({
  label,
  description,
  tooltip,
  inline,
  reserveLines,
  children,
}: {
  label: string;
  description?: string;
  tooltip?: string;
  inline?: boolean;
  /** Two lines kept for a description that changes, so the control under it never moves. */
  reserveLines?: boolean;
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
        <span
          className={cn(
            "text-3xs text-muted-foreground leading-tight",
            reserveLines && "line-clamp-2 h-[2lh]",
          )}
          title={reserveLines ? description : undefined}
        >
          {description}
        </span>
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
  /** Inert; the line under the label says why. */
  disabled?: boolean;
}

/** A setting on a slider that takes effect when the value is committed: on
 * release, or once a burst of key steps ends. */
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
  disabled = false,
}: CommittedSliderRowProps) {
  const { shown, bind } = useCommittedSlider(value, onCommit);

  return (
    <SettingRow
      label={label}
      description={describe(shown)}
      reserveLines
      {...(tooltip ? { tooltip } : {})}
    >
      <div className="flex items-center gap-2 flex-1">
        <Slider
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          {...bind}
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
