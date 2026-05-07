import type { ReactNode } from "react";
import { useUiStore } from "@/stores/uiStore";
import { useCapabilities } from "@/api/hooks/useServer";
import { NAV_ITEMS } from "@/lib/constants";
import { CanvasView } from "@/components/generation/CanvasView";
import { GalleryView } from "@/components/gallery/GalleryView";
import { CaptionView } from "@/components/caption/CaptionView";
import { ProcessView } from "@/components/process/ProcessView";
import { VideoView } from "@/components/video/VideoView";
import { KeepAlivePanel, KeepAliveSwitch } from "@/components/ui/keep-alive";
import { VideoOff } from "lucide-react";

function UnavailablePlaceholder({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
      <VideoOff size={48} strokeWidth={1} />
      <p className="text-sm">{label} requires additional models to be installed.</p>
    </div>
  );
}

// Hoist panel JSX to module scope so React element references stay stable
// across re-renders. Without this, every parent render rebuilds every panel,
// forcing the reconciler to walk every kept-alive subtree on every state change.
function viewPanel(id: string, content: ReactNode) {
  return (
    <KeepAlivePanel key={id} id={id} activeClassName="size-full">
      {content}
    </KeepAlivePanel>
  );
}

const VIEW_PANELS = [
  viewPanel("images", <CanvasView />),
  viewPanel("gallery", <GalleryView />),
  viewPanel("video", <VideoView />),
  viewPanel("process", <ProcessView />),
  viewPanel("caption", <CaptionView />),
];

export function MainCanvas() {
  const activeView = useUiStore((s) => s.activeNavView);
  const capabilities = useCapabilities();

  const navItem = NAV_ITEMS.find((n) => n.id === activeView);
  const unavailable = navItem?.capability && capabilities && !capabilities[navItem.capability];

  if (unavailable) {
    return <UnavailablePlaceholder label={navItem.label} />;
  }

  return <KeepAliveSwitch active={activeView}>{VIEW_PANELS}</KeepAliveSwitch>;
}
