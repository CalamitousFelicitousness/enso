import { useRef, useState } from "react";
import { LeftTabRail } from "./LeftTabRail";
import { TopToolBar } from "./TopToolBar";
import { BottomStatusBar } from "./BottomStatusBar";
import { MainCanvas } from "./MainCanvas";
import { LeftTabPanel } from "./LeftTabPanel";
import { RightTabRail } from "@/components/aside/RightTabRail";
import { RightTabPanel } from "@/components/aside/RightTabPanel";
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
  useShortcut("toggle-left-panel", () => useUiStore.getState().toggleLeftPanel());
  useShortcut("toggle-right-panel", () => useUiStore.getState().toggleRightPanel());

  const leftPanelCollapsed = useUiStore((s) => s.leftPanelCollapsed);
  const viewCollapsed = useUiStore((s) => s.viewCollapsed);
  const leftPanelWidth = useUiStore((s) => s.leftPanelWidth);
  const leftHidden = leftPanelCollapsed || viewCollapsed;
  const rightPanelCollapsed = useUiStore((s) => s.rightPanelCollapsed);
  const rightPanelWidth = useUiStore((s) => s.rightPanelWidth);

  const [leftResizing, setLeftResizing] = useState(false);
  const [rightResizing, setRightResizing] = useState(false);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <LeftTabRail />

      <div className="flex flex-1 flex-col min-w-0">
        <TopToolBar />

        <div className="flex flex-1 min-h-0">
          <aside
            className={cn(
              "border-r border-border bg-card flex-shrink-0 overflow-hidden",
              !leftResizing && "transition-[width] duration-200",
              leftHidden && "w-0 border-r-0",
            )}
            style={{ width: leftHidden ? 0 : leftPanelWidth }}
          >
            {!leftHidden && <LeftTabPanel />}
          </aside>

          {!leftHidden && <PanelResizeHandle side="left" onResizingChange={setLeftResizing} />}

          <main className="flex-1 min-w-0 overflow-auto">
            <MainCanvas />
          </main>

          {!rightPanelCollapsed && (
            <PanelResizeHandle side="right" onResizingChange={setRightResizing} />
          )}

          <aside
            className={cn(
              "border-l border-border bg-card flex-shrink-0 overflow-hidden",
              !rightResizing && "transition-[width] duration-200",
              rightPanelCollapsed && "w-0 border-l-0",
            )}
            style={{ width: rightPanelCollapsed ? 0 : rightPanelWidth }}
          >
            {!rightPanelCollapsed && <RightTabPanel />}
          </aside>

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

function PanelResizeHandle({
  side,
  onResizingChange,
}: {
  side: "left" | "right";
  onResizingChange: (resizing: boolean) => void;
}) {
  // The left handle sits on the panel's right edge (drag right = wider); the
  // right handle sits on the panel's left edge (drag left = wider), so the
  // pointer delta is inverted for the right side.
  const setWidth = useUiStore((s) =>
    side === "left" ? s.setLeftPanelWidth : s.setRightPanelWidth,
  );
  const start = useRef<{ x: number; width: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const s = useUiStore.getState();
    start.current = { x: e.clientX, width: side === "left" ? s.leftPanelWidth : s.rightPanelWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
    onResizingChange(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const delta = e.clientX - start.current.x;
    setWidth(start.current.width + (side === "left" ? delta : -delta));
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    start.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    onResizingChange(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      className={cn(
        "relative z-10 w-px shrink-0 cursor-col-resize bg-border transition-colors duration-150 hover:bg-ring/60",
        "before:absolute before:inset-y-0 before:-left-1 before:-right-1 before:content-['']",
      )}
    />
  );
}
