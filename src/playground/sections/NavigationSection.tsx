import { useState } from "react";
import { Sun, Moon, Monitor, Layers, Grid, List } from "lucide-react";
import {
  SegmentedControl,
  type SegmentOption,
} from "@/components/ui/segmented-control";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";

const textOptions: SegmentOption[] = [
  { value: "one", label: "One" },
  { value: "two", label: "Two" },
  { value: "three", label: "Three" },
];

const iconLabelOptions: SegmentOption[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

const iconOnlyOptions: SegmentOption[] = [
  { value: "layers", label: "Layers", icon: Layers },
  { value: "grid", label: "Grid", icon: Grid },
  { value: "list", label: "List", icon: List },
];

const stackedOptions: SegmentOption[] = [
  { value: "layers", label: "Layers", icon: Layers },
  { value: "grid", label: "Grid", icon: Grid },
  { value: "list", label: "List", icon: List },
];

export function NavigationSection() {
  const [defaultVal, setDefaultVal] = useState("one");
  const [defaultAnimVal, setDefaultAnimVal] = useState("one");
  const [iconLabelVal, setIconLabelVal] = useState("light");
  const [iconLabelAnimVal, setIconLabelAnimVal] = useState("light");
  const [iconOnlyVal, setIconOnlyVal] = useState("layers");
  const [iconOnlyAnimVal, setIconOnlyAnimVal] = useState("layers");
  const [denseVal, setDenseVal] = useState("one");
  const [denseAnimVal, setDenseAnimVal] = useState("one");
  const [tabsVal, setTabsVal] = useState("one");
  const [tabsAnimVal, setTabsAnimVal] = useState("one");
  const [stackedVal, setStackedVal] = useState("layers");
  const [stackedAnimVal, setStackedAnimVal] = useState("layers");
  const [neonWireVal, setNeonWireVal] = useState("one");

  return (
    <section
      id="navigation"
      className="rounded-lg border border-border/50 bg-card p-5 space-y-6"
    >
      <h2 className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
        Navigation
      </h2>

      {/* SegmentedControl */}
      <div className="space-y-5">
        <h3 className="text-3xs font-medium uppercase tracking-wider text-muted-foreground/80">
          SegmentedControl
        </h3>

        {/* default */}
        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">
            variant: default
          </span>
          <div className="flex items-center gap-3">
            <SegmentedControl
              options={textOptions}
              value={defaultVal}
              onValueChange={setDefaultVal}
              variant="default"
            />
          </div>
        </div>

        {/* default animated */}
        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">
            variant: default (animated)
          </span>
          <div className="flex items-center gap-3">
            <SegmentedControl
              options={textOptions}
              value={defaultAnimVal}
              onValueChange={setDefaultAnimVal}
              variant="default"
              animated
            />
          </div>
        </div>

        {/* icon-label */}
        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">
            variant: icon-label
          </span>
          <div className="flex items-center gap-3">
            <SegmentedControl
              options={iconLabelOptions}
              value={iconLabelVal}
              onValueChange={setIconLabelVal}
              variant="icon-label"
            />
          </div>
        </div>

        {/* icon-label animated */}
        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">
            variant: icon-label (animated)
          </span>
          <div className="flex items-center gap-3">
            <SegmentedControl
              options={iconLabelOptions}
              value={iconLabelAnimVal}
              onValueChange={setIconLabelAnimVal}
              variant="icon-label"
              animated
            />
          </div>
        </div>

        {/* icon-only */}
        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">
            variant: icon-only
          </span>
          <div className="flex items-center gap-3">
            <SegmentedControl
              options={iconOnlyOptions}
              value={iconOnlyVal}
              onValueChange={setIconOnlyVal}
              variant="icon-only"
            />
          </div>
        </div>

        {/* icon-only animated */}
        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">
            variant: icon-only (animated)
          </span>
          <div className="flex items-center gap-3">
            <SegmentedControl
              options={iconOnlyOptions}
              value={iconOnlyAnimVal}
              onValueChange={setIconOnlyAnimVal}
              variant="icon-only"
              animated
            />
          </div>
        </div>

        {/* dense */}
        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">
            variant: dense
          </span>
          <div className="flex items-center gap-3">
            <SegmentedControl
              options={textOptions}
              value={denseVal}
              onValueChange={setDenseVal}
              variant="dense"
            />
          </div>
        </div>

        {/* dense animated */}
        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">
            variant: dense (animated)
          </span>
          <div className="flex items-center gap-3">
            <SegmentedControl
              options={textOptions}
              value={denseAnimVal}
              onValueChange={setDenseAnimVal}
              variant="dense"
              animated
            />
          </div>
        </div>

        {/* tabs */}
        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">
            variant: tabs
          </span>
          <div className="flex items-center gap-3">
            <SegmentedControl
              options={textOptions}
              value={tabsVal}
              onValueChange={setTabsVal}
              variant="tabs"
            />
          </div>
        </div>

        {/* tabs animated */}
        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">
            variant: tabs (animated)
          </span>
          <div className="flex items-center gap-3">
            <SegmentedControl
              options={textOptions}
              value={tabsAnimVal}
              onValueChange={setTabsAnimVal}
              variant="tabs"
              animated
            />
          </div>
        </div>

        {/* stacked */}
        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">
            variant: stacked
          </span>
          <div className="flex items-center gap-3">
            <SegmentedControl
              options={stackedOptions}
              value={stackedVal}
              onValueChange={setStackedVal}
              variant="stacked"
            />
          </div>
        </div>

        {/* stacked animated */}
        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">
            variant: stacked (animated)
          </span>
          <div className="flex items-center gap-3">
            <SegmentedControl
              options={stackedOptions}
              value={stackedAnimVal}
              onValueChange={setStackedAnimVal}
              variant="stacked"
              animated
            />
          </div>
        </div>

        {/* neon-wire */}
        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">
            variant: neon-wire
          </span>
          <div className="flex items-center gap-3">
            <SegmentedControl
              options={textOptions}
              value={neonWireVal}
              onValueChange={setNeonWireVal}
              variant="neon-wire"
            />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="space-y-5">
        <h3 className="text-3xs font-medium uppercase tracking-wider text-muted-foreground/80">
          Tabs
        </h3>

        {/* default */}
        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">
            TabsList variant: default
          </span>
          <Tabs defaultValue="a">
            <TabsList>
              <TabsTrigger value="a">Tab A</TabsTrigger>
              <TabsTrigger value="b">Tab B</TabsTrigger>
              <TabsTrigger value="c">Tab C</TabsTrigger>
            </TabsList>
            <TabsContent value="a">
              <p className="text-xs text-muted-foreground p-2">Content A</p>
            </TabsContent>
            <TabsContent value="b">
              <p className="text-xs text-muted-foreground p-2">Content B</p>
            </TabsContent>
            <TabsContent value="c">
              <p className="text-xs text-muted-foreground p-2">Content C</p>
            </TabsContent>
          </Tabs>
        </div>

        {/* line */}
        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">
            TabsList variant: line
          </span>
          <Tabs defaultValue="a">
            <TabsList variant="line">
              <TabsTrigger value="a">Tab A</TabsTrigger>
              <TabsTrigger value="b">Tab B</TabsTrigger>
              <TabsTrigger value="c">Tab C</TabsTrigger>
            </TabsList>
            <TabsContent value="a">
              <p className="text-xs text-muted-foreground p-2">Content A</p>
            </TabsContent>
            <TabsContent value="b">
              <p className="text-xs text-muted-foreground p-2">Content B</p>
            </TabsContent>
            <TabsContent value="c">
              <p className="text-xs text-muted-foreground p-2">Content C</p>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </section>
  );
}
