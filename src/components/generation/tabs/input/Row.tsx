import { ParamLabel } from "@/components/generation/ParamLabel";

/** A label beside its control, at one label width across the inspector. */
export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <ParamLabel className="text-2xs text-muted-foreground w-16 flex-shrink-0">{label}</ParamLabel>
      {children}
    </div>
  );
}
