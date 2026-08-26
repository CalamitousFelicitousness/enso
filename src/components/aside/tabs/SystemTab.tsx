import { useCallback, useState } from "react";
import { RotateCcw, PowerOff, Activity } from "lucide-react";
import {
  useProfilingState,
  useRestartServer,
  useShutdownServer,
  useToggleProfiling,
} from "@/api/hooks/useSystem";
import { useRegisterCommand } from "@/lib/commandRegistry";
import { useUiStore, type SystemSubTab } from "@/stores/uiStore";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { KeepAliveSwitch, useKeepAliveVisible } from "@/components/ui/keep-alive";
import { buildPanels } from "@/components/ui/tab-panels";
import { cn } from "@/lib/utils";

import { OverviewSubTab } from "@/components/system/sub-tabs/OverviewSubTab";
import { UpdateSubTab } from "@/components/system/sub-tabs/UpdateSubTab";
import { ActivityLogSubTab } from "@/components/system/sub-tabs/ActivityLogSubTab";
import { GpuMonitorSubTab } from "@/components/system/sub-tabs/GpuMonitorSubTab";
import { SystemInfoSubTab } from "@/components/system/sub-tabs/SystemInfoSubTab";
import { BenchmarkSubTab } from "@/components/system/sub-tabs/BenchmarkSubTab";
import { StorageSubTab } from "@/components/system/sub-tabs/StorageSubTab";

const SUB_TABS: readonly SystemSubTab[] = [
  "Overview",
  "Storage",
  "Update",
  "Activity",
  "GPU Monitor",
  "System Info",
  "Benchmark",
] as const;

const SUB_PANELS = buildPanels([
  { id: "system-Overview", content: <OverviewSubTab /> },
  { id: "system-Storage", content: <StorageSubTab /> },
  { id: "system-Update", content: <UpdateSubTab /> },
  { id: "system-Activity", content: <ActivityLogSubTab /> },
  { id: "system-GPU Monitor", content: <GpuMonitorSubTab /> },
  { id: "system-System Info", content: <SystemInfoSubTab /> },
  { id: "system-Benchmark", content: <BenchmarkSubTab /> },
]);

export function SystemTab() {
  const visible = useKeepAliveVisible();
  const active = useUiStore((s) => s.panelSelections.systemSubTab);
  const setPanelSelection = useUiStore((s) => s.setPanelSelection);
  const setActive = useCallback(
    (tab: SystemSubTab) => setPanelSelection("systemSubTab", tab),
    [setPanelSelection],
  );
  const [confirmAction, setConfirmAction] = useState<"restart" | "shutdown" | null>(null);

  const restartServer = useRestartServer();
  const shutdownServer = useShutdownServer();
  const toggleProfiling = useToggleProfiling();
  const { data: profilingState } = useProfilingState(visible);
  const profiling = profilingState?.enabled ?? false;

  const reportError = useCallback(
    (verb: string) => (err: unknown) => {
      toast.error(`Failed to ${verb}`, {
        description: err instanceof Error ? err.message : String(err),
      });
    },
    [],
  );

  function handleConfirm() {
    if (confirmAction === "restart") {
      restartServer.mutate(undefined, { onError: reportError("restart server") });
    } else if (confirmAction === "shutdown") {
      shutdownServer.mutate(undefined, { onError: reportError("shutdown server") });
    }
    setConfirmAction(null);
  }

  function handleProfiling() {
    toggleProfiling.mutate(undefined, {
      onError: reportError("toggle profiling"),
    });
  }

  useRegisterCommand({
    id: "system:restart",
    label: "Restart server",
    group: "System",
    keywords: ["reboot", "reload server", "apply changes"],
    icon: RotateCcw,
    run: () => setConfirmAction("restart"),
  });
  useRegisterCommand({
    id: "system:shutdown",
    label: "Shutdown server",
    group: "System",
    keywords: ["stop", "power off", "quit", "exit"],
    icon: PowerOff,
    run: () => setConfirmAction("shutdown"),
  });
  useRegisterCommand({
    id: "system:toggle-profiling",
    label: "Toggle profiling",
    group: "System",
    keywords: ["profile", "performance", "trace", "diagnostics", "start", "stop"],
    icon: Activity,
    run: handleProfiling,
  });

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="bg-card p-2 space-y-2 border-b border-border shrink-0">
        <div className="flex items-center gap-1 flex-wrap">
          <Button size="sm" variant="destructive-soft" onClick={() => setConfirmAction("restart")}>
            <RotateCcw />
            Restart
          </Button>
          <Button size="sm" variant="destructive-soft" onClick={() => setConfirmAction("shutdown")}>
            <PowerOff />
            Shutdown
          </Button>
          <Button
            size="sm"
            variant={profiling ? "default" : "ghost"}
            className="h-7 px-2 text-2xs ml-auto"
            title="Toggle profiling"
            onClick={handleProfiling}
          >
            <Activity className="h-3.5 w-3.5 mr-1" />
            {profiling ? "Stop" : "Profile"}
          </Button>
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          {SUB_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActive(tab)}
              className={cn(
                "px-2 py-0.5 rounded-md text-2xs font-medium transition-colors",
                active === tab
                  ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <KeepAliveSwitch active={`system-${active}`}>{SUB_PANELS}</KeepAliveSwitch>

      <Dialog
        open={confirmAction !== null}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {confirmAction === "restart" ? "Restart Server" : "Shutdown Server"}
            </DialogTitle>
            <DialogDescription>
              {confirmAction === "restart"
                ? "The server will restart. You may lose connection temporarily."
                : "The server will shut down completely. You will need to start it manually."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleConfirm}
              disabled={restartServer.isPending || shutdownServer.isPending}
            >
              {confirmAction === "restart" ? "Restart" : "Shutdown"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
