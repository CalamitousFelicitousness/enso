import { IMAGES_SUB_TABS, type ImagesSubTab } from "@/lib/constants";
import { createTabRegistry } from "@/components/layout/tabRegistry";
import { PromptsTab } from "./PromptsTab";
import { SamplerTab } from "./SamplerTab";
import { GuidanceTab } from "./GuidanceTab";
import { RefineTab } from "./RefineTab";
import { DetailTab } from "./DetailTab";
import { AdvancedTab } from "./AdvancedTab";
import { ColorTab } from "./ColorTab";
import { ControlTab } from "./ControlTab";
import { ScriptsTab } from "./ScriptsTab";

export const IMAGES_TAB_REGISTRY = createTabRegistry<ImagesSubTab>({
  namespace: "images",
  tabs: IMAGES_SUB_TABS,
  components: {
    prompts: PromptsTab,
    sampler: SamplerTab,
    guidance: GuidanceTab,
    refine: RefineTab,
    detail: DetailTab,
    advanced: AdvancedTab,
    color: ColorTab,
    control: ControlTab,
    scripts: ScriptsTab,
  },
});
