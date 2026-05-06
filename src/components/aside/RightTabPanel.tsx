import { lazy, Suspense } from "react";
import { RIGHT_TABS } from "@/lib/constants";
import { useUiStore } from "@/stores/uiStore";
import { ScrollArea } from "@/components/ui/scroll-area";
import { KeepAlivePanel, KeepAliveSwitch } from "@/components/ui/keep-alive";

const QuickSettingsTab = lazy(() =>
  import("./tabs/QuickSettingsTab").then((m) => ({
    default: m.QuickSettingsTab,
  })),
);
const NetworksTab = lazy(() =>
  import("./tabs/NetworksTab").then((m) => ({ default: m.NetworksTab })),
);
const ModelsTab = lazy(() =>
  import("./tabs/ModelsTab").then((m) => ({ default: m.ModelsTab })),
);
const ProvidersTab = lazy(() =>
  import("./tabs/ProvidersTab").then((m) => ({ default: m.ProvidersTab })),
);
const QueueTab = lazy(() =>
  import("./tabs/QueueTab").then((m) => ({ default: m.QueueTab })),
);
const ExtensionsTab = lazy(() =>
  import("./tabs/ExtensionsTab").then((m) => ({ default: m.ExtensionsTab })),
);
const SettingsTab = lazy(() =>
  import("./tabs/SettingsTab").then((m) => ({ default: m.SettingsTab })),
);
const SystemTab = lazy(() =>
  import("./tabs/SystemTab").then((m) => ({ default: m.SystemTab })),
);
const HistoryTab = lazy(() =>
  import("./tabs/HistoryTab").then((m) => ({ default: m.HistoryTab })),
);
const InfoTab = lazy(() =>
  import("./tabs/InfoTab").then((m) => ({ default: m.InfoTab })),
);
const ConsoleTab = lazy(() =>
  import("./tabs/ConsoleTab").then((m) => ({ default: m.ConsoleTab })),
);

const TAB_COMPONENTS: Record<
  string,
  React.LazyExoticComponent<React.ComponentType>
> = {
  "quick-settings": QuickSettingsTab,
  networks: NetworksTab,
  models: ModelsTab,
  providers: ProvidersTab,
  queue: QueueTab,
  extensions: ExtensionsTab,
  settings: SettingsTab,
  system: SystemTab,
  history: HistoryTab,
  info: InfoTab,
  console: ConsoleTab,
};

// Tabs that manage their own scrolling internally — render them without an
// outer ScrollArea so the inner one isn't double-wrapped.
const SELF_SCROLL_TABS = new Set<string>(["settings", "networks", "history", "console"]);

const FALLBACK = (
  <div className="p-3 text-xs text-muted-foreground">Loading...</div>
);

export function RightTabPanel() {
  const activeTab = useUiStore((s) => s.activeRightTab);
  const tabMeta = RIGHT_TABS.find((t) => t.id === activeTab);

  return (
    <div className="flex flex-col h-full min-w-0 bg-card">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        {tabMeta && <tabMeta.icon className="h-4 w-4 text-muted-foreground" />}
        <span className="text-sm font-medium">
          {tabMeta?.label ?? activeTab}
        </span>
      </div>
      <KeepAliveSwitch active={activeTab}>
        {Object.entries(TAB_COMPONENTS).map(([id, Comp]) => {
          const inner = (
            <Suspense fallback={FALLBACK}>
              <Comp />
            </Suspense>
          );
          return (
            <KeepAlivePanel
              key={id}
              id={id}
              activeClassName="flex-1 overflow-hidden"
            >
              {SELF_SCROLL_TABS.has(id) ? (
                inner
              ) : (
                <ScrollArea className="size-full">{inner}</ScrollArea>
              )}
            </KeepAlivePanel>
          );
        })}
      </KeepAliveSwitch>
    </div>
  );
}
