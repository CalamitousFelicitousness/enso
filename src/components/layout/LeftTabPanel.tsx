import { useUiStore } from "@/stores/uiStore";
import { ActionBar } from "@/components/generation/ActionBar";
import { ResultGallery } from "@/components/generation/ResultGallery";
import { IMAGES_TAB_REGISTRY } from "@/components/generation/tabs/registry";
import { useImagesTabs } from "@/components/generation/tabs/useImagesTabs";
import { CaptionPanel } from "@/components/caption/CaptionPanel";
import { GalleryPanel } from "@/components/gallery/GalleryPanel";
import { ProcessPanel } from "@/components/process/ProcessPanel";
import { VideoPanel } from "@/components/video/VideoPanel";
import { buildPanels } from "@/components/ui/tab-panels";
import { tabPanelEntries } from "./tabRegistry";
import { TabbedPanel } from "./TabbedPanel";
import { KeepAlivePanel, KeepAliveSwitch } from "@/components/ui/keep-alive";

// Module scope: stable element references, see buildPanels.
const IMAGES_PANELS = buildPanels(tabPanelEntries(IMAGES_TAB_REGISTRY));
const IMAGES_HEADER = <ActionBar />;
const IMAGES_FOOTER = <ResultGallery />;

function ImagesView() {
  const { activePanelId } = useImagesTabs();
  return (
    <TabbedPanel
      panels={IMAGES_PANELS}
      activePanelId={activePanelId}
      header={IMAGES_HEADER}
      footer={IMAGES_FOOTER}
    />
  );
}

const VIEW_PANELS = [
  <KeepAlivePanel key="caption" id="left-caption">
    <CaptionPanel />
  </KeepAlivePanel>,
  <KeepAlivePanel key="gallery" id="left-gallery">
    <GalleryPanel />
  </KeepAlivePanel>,
  <KeepAlivePanel key="process" id="left-process">
    <ProcessPanel />
  </KeepAlivePanel>,
  <KeepAlivePanel key="video" id="left-video">
    <VideoPanel />
  </KeepAlivePanel>,
  <KeepAlivePanel key="images" id="left-images">
    <ImagesView />
  </KeepAlivePanel>,
];

export function LeftTabPanel() {
  const activeView = useUiStore((s) => s.activeNavView);
  // Flex chassis is required: each VIEW_PANEL uses the default
  // activeClassName="flex-1 min-h-0", which only sizes correctly inside a
  // flex container with a defined height. The hosting <aside> in AppShell is
  // a block element, so without this wrapper the kept-alive panel div is
  // auto-height and any inner h-full child (GalleryPanel, ImagesView) ends
  // up un-bounded, breaking nested ScrollArea behavior.
  return (
    <div className="flex flex-col h-full min-w-0">
      <KeepAliveSwitch active={`left-${activeView}`}>{VIEW_PANELS}</KeepAliveSwitch>
    </div>
  );
}
