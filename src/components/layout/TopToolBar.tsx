import { useUiStore } from "@/stores/uiStore";
import { ModelSelector } from "@/components/models/ModelSelector";
import { PresetSelector } from "@/components/generation/PresetSelector";
import { ImageToolsMenu } from "@/components/generation/ImageToolsMenu";
import { ConnectionIndicator } from "@/components/connection/ConnectionIndicator";
import { PanelLeftOpen, Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUndo } from "@/undo/store";
import { pressUndo } from "@/undo/useUndoCommands";

/** Undo and Redo of the newest change in reach of the view on screen, each
 * naming what it would do; grayed out when there is nothing. */
function UndoButtons() {
  const undo = useUndo((s) => s.undo);
  const redo = useUndo((s) => s.redo);
  const busy = useUndo((s) => s.busy);
  return (
    <div className="flex items-center" data-tour="undo-redo" aria-busy={busy || undefined}>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => pressUndo("undo")}
        disabled={!undo.enabled}
        aria-label={undo.label}
        title={undo.label}
        className="text-muted-foreground"
      >
        <Undo2 size={16} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => pressUndo("redo")}
        disabled={!redo.enabled}
        aria-label={redo.label}
        title={redo.label}
        className="text-muted-foreground"
      >
        <Redo2 size={16} />
      </Button>
    </div>
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

      {/* Separator */}
      <div className="h-5 w-px bg-border flex-shrink-0" />

      {/* Undo and Redo, left of the spacer so the Connection Indicator's width cannot move them */}
      <div className="flex-shrink-0">
        <UndoButtons />
      </div>

      {/* Spacer */}
      <div className="flex-1 min-w-0" />

      {/* Right side controls */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <ConnectionIndicator />
      </div>
    </header>
  );
}
