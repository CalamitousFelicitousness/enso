import { lazy, Suspense, useState, useCallback } from "react";
import { RIGHT_TABS } from "@/lib/constants";
import { useUiStore } from "@/stores/uiStore";
import { ScrollArea } from "@/components/ui/scroll-area";

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
  queue: QueueTab,
  extensions: ExtensionsTab,
  settings: SettingsTab,
  system: SystemTab,
  history: HistoryTab,
  info: InfoTab,
  console: ConsoleTab,
};

const SELF_SCROLL_TABS = new Set<string>(["settings", "networks", "history", "console"]);

export function RightTabPanel() {
  const activeTab = useUiStore((s) => s.activeRightTab);
  const tabMeta = RIGHT_TABS.find((t) => t.id === activeTab);

  // Lazy-mount: tabs mount on first visit, then stay alive (hidden via CSS).
  const [visited, setVisited] = useState<Set<string>>(() => new Set([activeTab]));
  if (!visited.has(activeTab)) {
    setVisited(new Set(visited).add(activeTab));
  }

  const renderTab = useCallback(
    (id: string) => {
      const Comp = TAB_COMPONENTS[id];
      if (!Comp || !visited.has(id)) return null;
      const active = id === activeTab;
      const Wrapper = SELF_SCROLL_TABS.has(id) ? "div" : ScrollArea;
      return (
        <Wrapper
          key={id}
          className={active ? "flex-1 overflow-hidden" : "hidden"}
        >
          <Suspense
            fallback={
              <div className="p-3 text-xs text-muted-foreground">
                Loading...
              </div>
            }
          >
            <Comp />
          </Suspense>
        </Wrapper>
      );
    },
    [activeTab, visited],
  );

  return (
    <div className="flex flex-col h-full min-w-0 bg-card">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        {tabMeta && <tabMeta.icon className="h-4 w-4 text-muted-foreground" />}
        <span className="text-sm font-medium">
          {tabMeta?.label ?? activeTab}
        </span>
      </div>
      {Object.keys(TAB_COMPONENTS).map(renderTab)}
    </div>
  );
}
