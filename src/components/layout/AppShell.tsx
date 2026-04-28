import { LeftTabRail } from "./LeftTabRail";
import { TopToolBar } from "./TopToolBar";
import { BottomStatusBar } from "./BottomStatusBar";
import { MainCanvas } from "./MainCanvas";
import { LeftTabPanel } from "./LeftTabPanel";
import { RightTabRail } from "@/components/aside/RightTabRail";
import { RightTabPanel } from "@/components/aside/RightTabPanel";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useUiStore } from "@/stores/uiStore";
import { useHistoryInit } from "@/hooks/useHistoryInit";
import { useJobTracker } from "@/hooks/useJobTracker";
import { useGlobalWs } from "@/hooks/useGlobalWs";
import { useShortcutDispatcher } from "@/hooks/useShortcutDispatcher";
import { useShortcut } from "@/hooks/useShortcut";
import { useModelDefaultsSuggester } from "@/hooks/useModelDefaultsSuggester";
import { useModelSync } from "@/hooks/useModelSync";
import { ShortcutOverlay } from "@/components/ShortcutOverlay";
import { CommandPalette } from "@/components/CommandPalette";
import { ComparisonDialog } from "@/components/comparison/ComparisonDialog";
import { TutorialOverlay } from "@/components/TutorialOverlay";
import { cn } from "@/lib/utils";

export function AppShell() {
  useHistoryInit();
  useJobTracker();
  useGlobalWs();
  useShortcutDispatcher();
  useModelDefaultsSuggester();
  useModelSync();

  useShortcut("toggle-left-rail", () => useUiStore.getState().toggleLeftRail());
  useShortcut("toggle-left-panel", () =>
    useUiStore.getState().toggleLeftPanel(),
  );
  useShortcut("toggle-right-panel", () =>
    useUiStore.getState().toggleRightPanel(),
  );

  const leftPanelCollapsed = useUiStore((s) => s.leftPanelCollapsed);
  const viewCollapsed = useUiStore((s) => s.viewCollapsed);
  const leftPanelWidth = useUiStore((s) => s.leftPanelWidth);
  const leftHidden = leftPanelCollapsed || viewCollapsed;
  const rightPanelCollapsed = useUiStore((s) => s.rightPanelCollapsed);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <LeftTabRail />

      <div className="flex flex-1 flex-col min-w-0">
        <TopToolBar />

        <div className="flex flex-1 min-h-0">
          <aside
            className={cn(
              "border-r border-border bg-card flex-shrink-0 overflow-hidden transition-[width] duration-200",
              leftHidden && "w-0 border-r-0",
            )}
            style={{ width: leftHidden ? 0 : leftPanelWidth }}
          >
            {!leftHidden && <LeftTabPanel />}
          </aside>

          <ResizablePanelGroup
            orientation="horizontal"
            id="layout-main"
            className="flex-1"
          >
            <ResizablePanel id="panel-main" minSize="30%">
              <main className="h-full overflow-auto">
                <MainCanvas />
              </main>
            </ResizablePanel>
            {!rightPanelCollapsed && (
              <>
                <ResizableHandle />
                <ResizablePanel
                  id="panel-right"
                  minSize={280}
                  maxSize="70%"
                  defaultSize="30%"
                >
                  <RightTabPanel />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>

          <RightTabRail />
        </div>

        <BottomStatusBar />
      </div>

      <ShortcutOverlay />
      <CommandPalette />
      <ComparisonDialog />
      <TutorialOverlay />
    </div>
  );
}
