import { GuidanceTab } from "@/components/generation/tabs/GuidanceTab";
import { NetworksTab } from "@/components/aside/tabs/NetworksTab";
import { PlaygroundPanel } from "../PlaygroundPanel";
import { PlaygroundQueryProvider } from "../PlaygroundQueryProvider";
import { mockExtraNetworks, mockPromptStyles, mockOptions } from "../mocks/networksMock";

// Pre-seed all filter combinations so useExtraNetworks never hits loading state.
// PAGE_MAP: Model→"model", LoRA→"lora", Style→null, Wildcards→"wildcards", Embedding→"embedding", VAE→"vae"
const networkPages = ["model", "lora", "wildcards", "embedding", "vae", undefined] as const;
const networkMocks = [
  ...networkPages.map((page) => ({
    queryKey: ["extra-networks", { page, search: undefined, limit: 500 }],
    data: mockExtraNetworks,
  })),
  { queryKey: ["prompt-styles"], data: mockPromptStyles },
  { queryKey: ["options"], data: mockOptions },
];

/**
 * On-demand panel workspace.
 *
 * This section is for rendering REAL tab panels from the app in isolation.
 * Panels here are recreated on-demand when prototyping changes — not a
 * permanent catalog. See the playground workflow docs for how to add panels.
 */
export function PanelsSection() {
  return (
    <section id="panels" className="rounded-lg border border-border/50 bg-card p-5 space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
          Panels
        </h2>
        <p className="text-3xs text-muted-foreground/40">
          Real app panels rendered in isolation. Recreated on-demand for prototyping.
        </p>
      </div>

      {/* Each panel row is isolated so portals/popovers don't interfere */}

      {/* GuidanceTab — Tier 1, no API hooks needed */}
      <div className="flex items-start gap-6 flex-wrap">
        <PlaygroundPanel title="GuidanceTab" tag="example" width={280}>
          <GuidanceTab />
        </PlaygroundPanel>
      </div>

      {/* NetworksTab — Tier 4, needs query mocks */}
      <div className="flex items-start gap-6 flex-wrap">
        <PlaygroundQueryProvider
          mocks={networkMocks}
          prefixMocks={{ "extra-networks": mockExtraNetworks }}
        >
          <PlaygroundPanel title="NetworksTab" tag="current" width={420} height={700}>
            <NetworksTab />
          </PlaygroundPanel>
        </PlaygroundQueryProvider>
      </div>
    </section>
  );
}
