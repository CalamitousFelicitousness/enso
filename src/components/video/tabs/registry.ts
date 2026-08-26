import { VIDEO_SUB_TABS, type VideoSubTab } from "@/lib/constants";
import { createTabRegistry } from "@/components/layout/tabRegistry";
import { PromptsTab } from "./PromptsTab";
import { CloudTab } from "./CloudTab";
import { SamplingTab } from "./SamplingTab";
import { InputsTab } from "./InputsTab";
import { FramePackTab } from "./FramePackTab";
import { OutputTab } from "./OutputTab";

export const VIDEO_TAB_REGISTRY = createTabRegistry<VideoSubTab>({
  namespace: "video",
  tabs: VIDEO_SUB_TABS,
  components: {
    prompts: PromptsTab,
    cloud: CloudTab,
    sampling: SamplingTab,
    inputs: InputsTab,
    framepack: FramePackTab,
    output: OutputTab,
  },
});
