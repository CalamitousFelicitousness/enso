import { AlertTriangle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { JobWarning } from "@/api/types/v2";

/** Count of the lines the server logged at warning level or above during a
 * job; click to read them. Renders nothing when there are none. */
export function JobWarnings({
  warnings,
  className,
}: {
  warnings: JobWarning[] | undefined;
  className?: string | undefined;
}) {
  if (!warnings?.length) return null;
  const hasError = warnings.some((w) => w.level === "error");
  const noun = warnings.length === 1 ? "warning" : "warnings";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`${warnings.length} ${noun} from the server during this job`}
          className={cn(
            "inline-flex h-5 shrink-0 items-center gap-0.5 rounded px-1 font-mono text-3xs tabular-nums outline-none transition-colors hover:bg-white/5 focus-visible:ring-[3px] focus-visible:ring-ring/50",
            hasError ? "text-destructive" : "text-amber-400",
            className,
          )}
        >
          <AlertTriangle size={11} />
          {warnings.length}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <ul className="flex flex-col gap-1.5">
          {warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1.5 text-3xs">
              <span
                className={cn(
                  "mt-1 size-1.5 shrink-0 rounded-full",
                  w.level === "error" ? "bg-destructive" : "bg-amber-400",
                )}
              />
              <span className="min-w-0 break-words">{w.message}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
