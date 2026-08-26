import { NAV_ITEMS, EXTERNAL_LINKS } from "@/lib/constants";
import { useUiStore } from "@/stores/uiStore";
import { useTutorialStore } from "@/stores/tutorialStore";
import { useCapabilities } from "@/api/hooks/useServer";
import { useImagesTabs } from "@/components/generation/tabs/useImagesTabs";
import { useVideoTabs } from "@/components/video/tabs/useVideoTabs";
import { cn } from "@/lib/utils";
import { PanelLeftClose, PanelLeftOpen, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SubTabStrip } from "./SubTabStrip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";

/** Rendered as a child, not a hook call in LeftTabRail, so each view's
 * sub-tab data is only subscribed to while that view is active. */
function ImagesSubTabStrip() {
  const { visible, active, setActive } = useImagesTabs();
  return <SubTabStrip tabs={visible} value={active} onChange={setActive} />;
}

function VideoSubTabStrip() {
  const { visible, active, setActive } = useVideoTabs();
  return <SubTabStrip tabs={visible} value={active} onChange={setActive} />;
}

export function LeftTabRail() {
  const collapsed = useUiStore((s) => s.leftRailCollapsed);
  const activeView = useUiStore((s) => s.activeNavView);
  const viewCollapsed = useUiStore((s) => s.viewCollapsed);
  const setNavView = useUiStore((s) => s.setNavView);
  const toggleViewCollapsed = useUiStore((s) => s.toggleViewCollapsed);
  const toggleLeftRail = useUiStore((s) => s.toggleLeftRail);
  const startTutorial = useTutorialStore((s) => s.start);

  const capabilities = useCapabilities();

  const hasSubTabs = (activeView === "images" || activeView === "video") && !viewCollapsed;

  return (
    <div
      className={cn(
        "flex bg-rail border-r border-rail-border transition-[width] duration-200 flex-shrink-0",
        collapsed ? "w-0 overflow-hidden" : !hasSubTabs && "w-14",
      )}
    >
      {/* Column 1: Primary nav icons */}
      <nav className="flex flex-col w-14 flex-shrink-0">
        {/* Toggle button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleLeftRail}
          className="h-10 w-full rounded-none text-rail-foreground/60 hover:text-rail-foreground hover:bg-rail-accent"
          title={collapsed ? "Expand Left Rail" : "Collapse Left Rail"}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </Button>

        {/* Primary nav items */}
        <div className="flex flex-col gap-1 px-1.5 py-2 flex-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            const isGated =
              item.capability != null && capabilities != null && !capabilities[item.capability];
            return (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={isGated}
                    onClick={() => {
                      if (isGated) return;
                      if (isActive) {
                        toggleViewCollapsed();
                      } else {
                        setNavView(item.id);
                        if (viewCollapsed) toggleViewCollapsed();
                      }
                    }}
                    className={cn(
                      "w-full aspect-square text-rail-foreground/60 hover:text-rail-foreground hover:bg-rail-accent",
                      isActive && "bg-rail-accent text-primary",
                      isGated && "opacity-40 pointer-events-none",
                    )}
                  >
                    <Icon size={20} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {isGated ? `${item.label} is not available` : item.label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* Help + External links */}
        <div className="flex flex-col gap-0.5 px-1.5 pb-2">
          <Separator className="mb-1.5 bg-rail-border" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={startTutorial}
                className={cn(
                  "flex items-center justify-center w-full aspect-square rounded-md transition-colors",
                  "text-rail-foreground/30 hover:text-rail-foreground/60 hover:bg-rail-accent",
                )}
              >
                <HelpCircle size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Help</TooltipContent>
          </Tooltip>
          {EXTERNAL_LINKS.map((link) => {
            const Icon = link.icon;
            return (
              <Tooltip key={link.label}>
                <TooltipTrigger asChild>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "flex items-center justify-center w-full aspect-square rounded-md transition-colors",
                      "text-rail-foreground/30 hover:text-rail-foreground/60 hover:bg-rail-accent",
                    )}
                  >
                    <Icon size={16} />
                  </a>
                </TooltipTrigger>
                <TooltipContent side="right">{link.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </nav>

      {/* Column 2: Sub-tab labels (only for views with sub-tabs) */}
      {hasSubTabs && (
        <div
          data-tour="left-rail-subtabs"
          className="border-l border-rail-border py-2 overflow-y-auto"
        >
          {activeView === "video" ? <VideoSubTabStrip /> : <ImagesSubTabStrip />}
        </div>
      )}
    </div>
  );
}
