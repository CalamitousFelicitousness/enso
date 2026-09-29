import { SectionLeader } from "@/components/ui/section-leader";

interface ProcessSectionProps {
  title: string;
  tooltip?: string | undefined;
  enabled: boolean;
  onToggleEnabled: (v: boolean) => void;
  /** False when the script does nothing for the current input mode. */
  applies: boolean;
  /** Shown instead of the controls when the section does not apply. */
  inapplicableHint?: string | undefined;
  defaultCollapsed?: boolean | undefined;
  children: React.ReactNode;
}

/** Enableable, collapsible section for one postprocessing script. */
export function ProcessSection({
  title,
  tooltip,
  enabled,
  onToggleEnabled,
  applies,
  inapplicableHint,
  defaultCollapsed = true,
  children,
}: ProcessSectionProps) {
  return (
    <SectionLeader
      title={title}
      tooltip={tooltip}
      enableable
      enabled={enabled}
      onToggleEnabled={onToggleEnabled}
      collapsible
      defaultCollapsed={defaultCollapsed}
      parentDisabled={!applies}
    >
      {applies ? (
        <div className={enabled ? "flex flex-col gap-2" : "flex flex-col gap-2 opacity-50"}>
          {children}
        </div>
      ) : (
        <p className="text-2xs text-muted-foreground">
          {inapplicableHint ?? "Not used for this input."}
        </p>
      )}
    </SectionLeader>
  );
}

/** A checkbox with a label, in the dense style the tabs use. */
export function CheckRow({
  label,
  checked,
  onCheckedChange,
  disabled,
  title,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean | undefined;
  title?: string | undefined;
}) {
  return (
    <label
      className="flex items-center gap-1.5 text-2xs text-muted-foreground cursor-pointer"
      title={title}
    >
      <input
        type="checkbox"
        className="accent-primary size-3"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
