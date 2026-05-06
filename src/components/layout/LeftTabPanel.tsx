import type { ReactNode } from "react";
import { useUiStore } from "@/stores/uiStore";
import { useCloudModelGating } from "@/hooks/useCloudModelGating";
import { ActionBar } from "@/components/generation/ActionBar";
import { ResultGallery } from "@/components/generation/ResultGallery";
import { PromptsTab } from "@/components/generation/tabs/PromptsTab";
import { SamplerTab } from "@/components/generation/tabs/SamplerTab";
import { GuidanceTab } from "@/components/generation/tabs/GuidanceTab";
import { RefineTab } from "@/components/generation/tabs/RefineTab";
import { AdvancedTab } from "@/components/generation/tabs/AdvancedTab";
import { ColorTab } from "@/components/generation/tabs/ColorTab";
import { DetailTab } from "@/components/generation/tabs/DetailTab";
import { ControlTab } from "@/components/generation/tabs/ControlTab";
import { ScriptsTab } from "@/components/generation/tabs/ScriptsTab";
import { CaptionPanel } from "@/components/caption/CaptionPanel";
import { GalleryPanel } from "@/components/gallery/GalleryPanel";
import { ProcessPanel } from "@/components/process/ProcessPanel";
import { VideoPanel } from "@/components/video/VideoPanel";
import { ScrollArea } from "@/components/ui/scroll-area";
import { KeepAlivePanel, KeepAliveSwitch } from "@/components/ui/keep-alive";

export function LeftTabPanel() {
  const activeView = useUiStore((s) => s.activeNavView);

  return (
    <KeepAliveSwitch active={activeView}>
      <KeepAlivePanel id="caption">
        <CaptionPanel />
      </KeepAlivePanel>
      <KeepAlivePanel id="gallery">
        <GalleryPanel />
      </KeepAlivePanel>
      <KeepAlivePanel id="process">
        <ProcessPanel />
      </KeepAlivePanel>
      <KeepAlivePanel id="video">
        <VideoPanel />
      </KeepAlivePanel>
      <KeepAlivePanel id="images">
        <ImagesView />
      </KeepAlivePanel>
    </KeepAliveSwitch>
  );
}

function ImagesView() {
  const activeSubTab = useUiStore((s) => s.activeImagesSubTab);
  const { showTab } = useCloudModelGating();
  const resolvedSubTab = showTab(activeSubTab) ? activeSubTab : "prompts";

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="px-3 py-2 border-b border-border">
        <ActionBar />
      </div>
      <KeepAliveSwitch active={resolvedSubTab}>
        {subPanel("prompts", <PromptsTab />)}
        {subPanel("sampler", <SamplerTab />)}
        {subPanel("guidance", <GuidanceTab />)}
        {subPanel("refine", <RefineTab />)}
        {subPanel("detail", <DetailTab />)}
        {subPanel("advanced", <AdvancedTab />)}
        {subPanel("color", <ColorTab />)}
        {subPanel("control", <ControlTab />)}
        {subPanel("scripts", <ScriptsTab />)}
      </KeepAliveSwitch>
      <div className="border-t border-border px-2 py-1.5">
        <ResultGallery />
      </div>
    </div>
  );
}

function subPanel(id: string, content: ReactNode) {
  return (
    <KeepAlivePanel key={id} id={id} activeClassName="flex-1 overflow-hidden">
      <ScrollArea className="size-full">
        <div className="p-3 min-w-0">{content}</div>
      </ScrollArea>
    </KeepAlivePanel>
  );
}
