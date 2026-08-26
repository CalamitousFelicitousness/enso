import { useMemo } from "react";
import { useUiStore } from "@/stores/uiStore";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { TabDescriptor } from "./tabRegistry";

interface SubTabStripProps<Id extends string> {
  /** Already filtered to what the active model offers. */
  tabs: readonly TabDescriptor<Id>[];
  value: Id;
  onChange: (id: Id) => void;
}

/** Rail column 2: the vertical sub-tab strip for a view. */
export function SubTabStrip<Id extends string>({ tabs, value, onChange }: SubTabStripProps<Id>) {
  const leftPanelCollapsed = useUiStore((s) => s.leftPanelCollapsed);
  const viewCollapsed = useUiStore((s) => s.viewCollapsed);
  const toggleLeftPanel = useUiStore((s) => s.toggleLeftPanel);
  const toggleViewCollapsed = useUiStore((s) => s.toggleViewCollapsed);

  const options = useMemo(
    () => tabs.map((tab) => ({ value: tab.id, label: tab.label, icon: tab.icon })),
    [tabs],
  );

  return (
    <SegmentedControl
      options={options}
      value={value}
      onValueChange={(next) => {
        onChange(next);
        if (leftPanelCollapsed) toggleLeftPanel();
        if (viewCollapsed) toggleViewCollapsed();
      }}
      onActiveClick={() => {
        if (!leftPanelCollapsed && !viewCollapsed) toggleLeftPanel();
      }}
      variant="stacked"
      orientation="vertical"
      animated
      className="border-0 bg-transparent px-1.5 py-0 gap-0.5 rounded-none"
    />
  );
}
