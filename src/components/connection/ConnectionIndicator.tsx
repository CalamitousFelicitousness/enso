import { useServerInfo } from "@/api/hooks/useServer";
import { useVersionInfo } from "@/hooks/useVersionInfo";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Wifi, WifiOff, Loader2 } from "lucide-react";

const SYNC_TEXT = {
  "in-sync": "Frontend up to date",
  "dist-stale": "Frontend out of date - restart SD.Next",
  dev: "Dev server (working tree)",
  unknown: "Frontend sync unknown",
} as const;

export function ConnectionIndicator() {
  const { data: serverInfo, isLoading, isError } = useServerInfo();
  const version = useVersionInfo();

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 text-muted-foreground text-xs px-2">
        <Loader2 size={14} className="animate-spin" />
        <span>Connecting...</span>
      </div>
    );
  }

  if (isError || !serverInfo) {
    return (
      <div className="flex items-center gap-1.5 text-destructive text-xs px-2">
        <WifiOff size={14} />
        <span>Disconnected</span>
      </div>
    );
  }

  const label = serverInfo.platform || serverInfo.backend || "Connected";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5 text-emerald-500 text-xs px-2">
          <Wifi size={14} />
          <span className="hidden sm:inline">{label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="space-y-0.5">
        <div>
          UI build <span className="font-mono tabular-nums">{version.bundleShort}</span> (
          {version.bundleSource}, {version.bundleDate})
        </div>
        <div>
          Extension{" "}
          <span className="font-mono tabular-nums">{version.backendShort ?? "unknown"}</span>
        </div>
        <div>{SYNC_TEXT[version.syncState]}</div>
      </TooltipContent>
    </Tooltip>
  );
}
