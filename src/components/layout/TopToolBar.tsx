import { useUiStore } from "@/stores/uiStore";
import { ModelSelector } from "@/components/models/ModelSelector";
import { PresetSelector } from "@/components/generation/PresetSelector";
import { ImageToolsMenu } from "@/components/generation/ImageToolsMenu";
import { ConnectionIndicator } from "@/components/connection/ConnectionIndicator";
import { PanelLeftOpen, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runUndo, useUndoOffer } from "@/inputs/undo";
import { NOTHING_TO_UNDO, undoTitleText } from "@/lib/inputs/text";
import { formatShortcut, SHORTCUTS } from "@/lib/shortcuts";

/** Runs the change the notice showing offers to undo; grayed out while none does. */
function UndoButton() {
  const title = useUndoOffer((s) => s.title);
  const shortcut = SHORTCUTS["undo"];
  const label = title
    ? undoTitleText(title, shortcut ? formatShortcut(shortcut) : null)
    : NOTHING_TO_UNDO;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => void runUndo()}
      disabled={!title}
      aria-label={label}
      title={label}
      className="text-muted-foreground"
    >
      <Undo2 size={16} />
    </Button>
  );
}

export function TopToolBar() {
  const leftRailCollapsed = useUiStore((s) => s.leftRailCollapsed);
  const toggleLeftRail = useUiStore((s) => s.toggleLeftRail);

  return (
    <header className="flex items-center h-11 px-2 gap-2 border-b border-border bg-card flex-shrink-0">
      {/* Left Rail toggle (visible when rail is collapsed) */}
      {leftRailCollapsed && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleLeftRail}
          className="text-muted-foreground"
          title="Show Left Rail"
        >
          <PanelLeftOpen size={16} />
        </Button>
      )}

      {/* Model selector - shrinks to fit, keeps truncated model name */}
      <div className="min-w-0 flex-shrink">
        <ModelSelector />
      </div>

      {/* Separator */}
      <div className="h-5 w-px bg-border flex-shrink-0" />

      {/* Parameter presets */}
      <div className="flex-shrink-0">
        <PresetSelector />
      </div>

      {/* Separator */}
      <div className="h-5 w-px bg-border flex-shrink-0" />

      {/* Image tools */}
      <div className="flex-shrink-0">
        <ImageToolsMenu />
      </div>

      {/* Spacer */}
      <div className="flex-1 min-w-0" />

      {/* Right side controls */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <UndoButton />
        <ConnectionIndicator />
      </div>
    </header>
  );
}
