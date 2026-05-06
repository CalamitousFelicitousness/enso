import { useState, type ReactNode } from "react";
import { RotateCcw, PowerOff, Activity } from "lucide-react";
import {
  useRestartServer,
  useShutdownServer,
  useToggleProfiling,
} from "@/api/hooks/useSystem";
import { useRegisterCommand } from "@/lib/commandRegistry";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { KeepAlivePanel, KeepAliveSwitch } from "@/components/ui/keep-alive";
import { cn } from "@/lib/utils";

import { OverviewSubTab } from "@/components/system/sub-tabs/OverviewSubTab";
import { UpdateSubTab } from "@/components/system/sub-tabs/UpdateSubTab";
import { HistorySubTab } from "@/components/system/sub-tabs/HistorySubTab";
import { GpuMonitorSubTab } from "@/components/system/sub-tabs/GpuMonitorSubTab";
import { SystemInfoSubTab } from "@/components/system/sub-tabs/SystemInfoSubTab";
import { BenchmarkSubTab } from "@/components/system/sub-tabs/BenchmarkSubTab";
import { StorageSubTab } from "@/components/system/sub-tabs/StorageSubTab";

const SUB_TABS = [
  "Overview",
  "Storage",
  "Update",
  "History",
  "GPU Monitor",
  "System Info",
  "Benchmark",
] as const;

type SubTab = (typeof SUB_TABS)[number];

// Hoist panel JSX to module scope so React element references are stable
// across re-renders. Without this, every parent render rebuilds every panel,
// forcing the reconciler to walk every kept-alive subtree on every click.
function subPanel(id: SubTab, content: ReactNode) {
  return (
    <KeepAlivePanel key={id} id={id} activeClassName="flex-1 overflow-hidden">
      <ScrollArea className="size-full">
        <div className="p-3 min-w-0">{content}</div>
      </ScrollArea>
    </KeepAlivePanel>
  );
}

const SUB_PANELS = [
  subPanel("Overview", <OverviewSubTab />),
  subPanel("Storage", <StorageSubTab />),
  subPanel("Update", <UpdateSubTab />),
  subPanel("History", <HistorySubTab />),
  subPanel("GPU Monitor", <GpuMonitorSubTab />),
  subPanel("System Info", <SystemInfoSubTab />),
  subPanel("Benchmark", <BenchmarkSubTab />),
];

export function SystemTab() {
  const [active, setActive] = useState<SubTab>("Overview");
  const [confirmAction, setConfirmAction] = useState<
    "restart" | "shutdown" | null
  >(null);
  const [profiling, setProfiling] = useState(false);

  const restartServer = useRestartServer();
  const shutdownServer = useShutdownServer();
  const toggleProfiling = useToggleProfiling();

  function handleConfirm() {
    if (confirmAction === "restart") restartServer.mutate();
    else if (confirmAction === "shutdown") shutdownServer.mutate();
    setConfirmAction(null);
  }

  function handleProfiling() {
    toggleProfiling.mutate(undefined, {
      onSuccess: (data) => {
        if (data && typeof data === "object" && "enabled" in data) {
          setProfiling(data.enabled as boolean);
        }
      },
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
          <Button
            size="sm"
            variant="destructive-soft"
            onClick={() => setConfirmAction("restart")}
          >
            <RotateCcw />
            Restart
          </Button>
          <Button
            size="sm"
            variant="destructive-soft"
            onClick={() => setConfirmAction("shutdown")}
          >
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

      <KeepAliveSwitch active={active}>{SUB_PANELS}</KeepAliveSwitch>

      <Dialog
        open={confirmAction !== null}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {confirmAction === "restart"
                ? "Restart Server"
                : "Shutdown Server"}
            </DialogTitle>
            <DialogDescription>
              {confirmAction === "restart"
                ? "The server will restart. You may lose connection temporarily."
                : "The server will shut down completely. You will need to start it manually."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmAction(null)}
            >
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={handleConfirm}>
              {confirmAction === "restart" ? "Restart" : "Shutdown"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
