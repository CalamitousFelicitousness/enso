import { useState } from "react";
import { SectionLeader, SectionDivider } from "@/components/ui/section-leader";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import { RotateCcw } from "lucide-react";

function PlaceholderRows() {
  return (
    <div className="space-y-1.5">
      <div className="h-5 rounded bg-muted/30 w-full" />
      <div className="h-5 rounded bg-muted/30 w-3/4" />
    </div>
  );
}

export function LayoutSection() {
  const [hiresEnabled, setHiresEnabled] = useState(true);
  const [secondPassEnabled, setSecondPassEnabled] = useState(true);
  const [controlNetEnabled, setControlNetEnabled] = useState(true);

  return (
    <section id="layout" className="rounded-lg border border-border/50 bg-card p-5 space-y-6">
      <h2 className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
        Layout
      </h2>

      {/* SectionLeader */}
      <div className="space-y-4">
        <span className="text-3xs text-muted-foreground/60 uppercase tracking-wider">SectionLeader</span>

        <div className="w-[280px] space-y-4">
          {/* Mode 1 — Neither collapsible nor enableable */}
          <div className="space-y-1.5">
            <span className="text-3xs text-muted-foreground/60">neither</span>
            <SectionLeader title="Generation" level={0}>
              <PlaceholderRows />
            </SectionLeader>
          </div>

          {/* Mode 2 — Collapsible only */}
          <div className="space-y-1.5">
            <span className="text-3xs text-muted-foreground/60">collapsible</span>
            <SectionLeader title="Samplers" collapsible defaultCollapsed level={0}>
              <PlaceholderRows />
            </SectionLeader>
          </div>

          {/* Mode 3 — Enableable only */}
          <div className="space-y-1.5">
            <span className="text-3xs text-muted-foreground/60">enableable</span>
            <SectionLeader
              title="Hi-Res Fix"
              enableable
              enabled={hiresEnabled}
              onToggleEnabled={setHiresEnabled}
              level={0}
            >
              <PlaceholderRows />
            </SectionLeader>
          </div>

          {/* Mode 4 — Both collapsible and enableable */}
          <div className="space-y-1.5">
            <span className="text-3xs text-muted-foreground/60">both</span>
            <SectionLeader
              title="ControlNet"
              enableable
              collapsible
              enabled={controlNetEnabled}
              onToggleEnabled={setControlNetEnabled}
              level={0}
            >
              <PlaceholderRows />
            </SectionLeader>
          </div>

          {/* Nested — level 0 with level 1 child */}
          <div className="space-y-1.5">
            <span className="text-3xs text-muted-foreground/60">nested</span>
            <SectionLeader
              title="Refine"
              enableable
              collapsible
              enabled={hiresEnabled}
              onToggleEnabled={setHiresEnabled}
              level={0}
            >
              <PlaceholderRows />
              <SectionLeader
                title="Second Pass"
                enableable
                enabled={secondPassEnabled}
                onToggleEnabled={setSecondPassEnabled}
                parentDisabled={!hiresEnabled}
                level={1}
              >
                <PlaceholderRows />
              </SectionLeader>
            </SectionLeader>
          </div>

          {/* Action slot */}
          <div className="space-y-1.5">
            <span className="text-3xs text-muted-foreground/60">action slot</span>
            <SectionLeader
              title="With Action"
              collapsible
              level={0}
              action={
                <button
                  type="button"
                  className="text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              }
            >
              <PlaceholderRows />
            </SectionLeader>
          </div>
        </div>
      </div>

      {/* SectionDivider */}
      <div className="space-y-4">
        <span className="text-3xs text-muted-foreground/60 uppercase tracking-wider">SectionDivider</span>

        <div className="w-[280px] space-y-3">
          <div className="space-y-1.5">
            <span className="text-3xs text-muted-foreground/60">plain</span>
            <SectionDivider />
          </div>

          <div className="space-y-1.5">
            <span className="text-3xs text-muted-foreground/60">labeled</span>
            <SectionDivider label="Options" />
          </div>
        </div>
      </div>

      {/* Accordion */}
      <div className="space-y-4">
        <span className="text-3xs text-muted-foreground/60 uppercase tracking-wider">Accordion</span>

        <div className="w-[280px]">
          <Accordion type="single" collapsible>
            <AccordionItem value="item-1">
              <AccordionTrigger>General Settings</AccordionTrigger>
              <AccordionContent>
                <PlaceholderRows />
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-2">
              <AccordionTrigger>Advanced Options</AccordionTrigger>
              <AccordionContent>
                <PlaceholderRows />
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-3">
              <AccordionTrigger>Output Configuration</AccordionTrigger>
              <AccordionContent>
                <PlaceholderRows />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>

      {/* Separator */}
      <div className="space-y-4">
        <span className="text-3xs text-muted-foreground/60 uppercase tracking-wider">Separator</span>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <span className="text-3xs text-muted-foreground/60">horizontal</span>
            <div className="w-[280px]">
              <Separator orientation="horizontal" />
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-3xs text-muted-foreground/60">vertical</span>
            <div className="flex items-center gap-3 h-8">
              <span className="text-xs text-muted-foreground">Left</span>
              <Separator orientation="vertical" />
              <span className="text-xs text-muted-foreground">Right</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
