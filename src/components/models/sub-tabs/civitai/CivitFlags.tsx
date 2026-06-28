import { AlertTriangle, ShieldAlert, ShieldCheck, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CivitModel } from "@/api/types/civitai";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type FlagVariant = "destructive" | "outline" | "secondary";

interface CivitFlag {
  key: string;
  label: string;
  title: string;
  variant: FlagVariant;
  Icon: LucideIcon;
}

function collectFlags(model: Pick<CivitModel, "mode" | "poi" | "minor" | "sfwOnly">): CivitFlag[] {
  const flags: CivitFlag[] = [];
  if (model.mode) {
    const label = model.mode === "TakenDown" ? "Taken down" : model.mode;
    flags.push({
      key: "mode",
      label,
      title: `This model is ${label.toLowerCase()} on Civitai and may not be downloadable.`,
      variant: "destructive",
      Icon: AlertTriangle,
    });
  }
  if (model.minor) {
    flags.push({
      key: "minor",
      label: "Minor",
      title: "Flagged on Civitai as depicting a minor.",
      variant: "destructive",
      Icon: ShieldAlert,
    });
  }
  if (model.poi) {
    flags.push({
      key: "poi",
      label: "Real person",
      title: "Depicts a real, identifiable person.",
      variant: "outline",
      Icon: UserRound,
    });
  }
  if (model.sfwOnly) {
    flags.push({
      key: "sfwOnly",
      label: "SFW only",
      title: "Restricted to SFW content on Civitai.",
      variant: "secondary",
      Icon: ShieldCheck,
    });
  }
  return flags;
}

interface CivitFlagsProps {
  model: Pick<CivitModel, "mode" | "poi" | "minor" | "sfwOnly">;
  /** Icon-only badges for dense rows (result card); icon + text otherwise. */
  compact?: boolean;
  className?: string;
}

export function CivitFlags({ model, compact = false, className }: CivitFlagsProps) {
  const flags = collectFlags(model);
  if (flags.length === 0) return null;

  return (
    <span className={cn("flex items-center gap-1 shrink-0", className)}>
      {flags.map(({ key, label, title, variant, Icon }) => (
        <Badge
          key={key}
          variant={variant}
          title={title}
          role={compact ? "img" : undefined}
          aria-label={compact ? title : undefined}
          className={
            compact
              ? "text-4xs px-1 py-0 gap-0.5 [&>svg]:size-2.5"
              : "text-3xs px-1.5 py-0.5 [&>svg]:size-3"
          }
        >
          <Icon aria-hidden />
          {!compact && <span className="truncate">{label}</span>}
        </Badge>
      ))}
    </span>
  );
}
