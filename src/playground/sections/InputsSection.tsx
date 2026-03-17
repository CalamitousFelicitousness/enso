import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Combobox, type ComboboxGroup } from "@/components/ui/combobox";

const flatOptions = [
  "Euler a",
  "DPM++ 2M",
  "DPM++ SDE",
  "DDIM",
  "UniPC",
  "LMS",
  "Heun",
  "DPM2 a",
];

const groupedOptions: ComboboxGroup[] = [
  { heading: "Recommended", options: ["Euler a", "DPM++ 2M Karras"] },
  { heading: "Fast", options: ["LCM", "Lightning", "Hyper"] },
  { heading: "Quality", options: ["DPM++ SDE Karras", "UniPC"] },
];

export function InputsSection() {
  const [sampler, setSampler] = useState("Euler a");
  const [groupedSampler, setGroupedSampler] = useState("DPM++ 2M Karras");

  return (
    <section id="inputs" className="rounded-lg border border-border/50 bg-card p-5 space-y-6">
      <h2 className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
        Inputs
      </h2>

      {/* Input */}
      <div className="space-y-4">
        <span className="text-3xs text-muted-foreground/60 uppercase tracking-wider">Input</span>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <span className="text-3xs text-muted-foreground/60">empty</span>
            <Input placeholder="Type here..." className="w-[240px]" />
          </div>

          <div className="space-y-1.5">
            <span className="text-3xs text-muted-foreground/60">filled</span>
            <Input value="Filled" readOnly className="w-[240px]" />
          </div>

          <div className="space-y-1.5">
            <span className="text-3xs text-muted-foreground/60">disabled</span>
            <Input disabled placeholder="Disabled" className="w-[240px]" />
          </div>
        </div>
      </div>

      {/* Textarea */}
      <div className="space-y-4">
        <span className="text-3xs text-muted-foreground/60 uppercase tracking-wider">Textarea</span>

        <div className="space-y-1.5">
          <Textarea placeholder="Write a prompt..." className="min-h-[80px] w-[280px]" />
        </div>
      </div>

      {/* Label + Input */}
      <div className="space-y-4">
        <span className="text-3xs text-muted-foreground/60 uppercase tracking-wider">Label</span>

        <div className="space-y-1.5">
          <Label htmlFor="demo-label">Label</Label>
          <Input id="demo-label" placeholder="With label..." className="w-[240px]" />
        </div>
      </div>

      {/* Combobox — flat */}
      <div className="space-y-4">
        <span className="text-3xs text-muted-foreground/60 uppercase tracking-wider">Combobox</span>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <span className="text-3xs text-muted-foreground/60">flat (8 options)</span>
            <Combobox
              value={sampler}
              onValueChange={setSampler}
              options={flatOptions}
              placeholder="Sampler..."
              className="w-[240px]"
            />
          </div>

          <div className="space-y-1.5">
            <span className="text-3xs text-muted-foreground/60">grouped</span>
            <Combobox
              value={groupedSampler}
              onValueChange={setGroupedSampler}
              groups={groupedOptions}
              placeholder="Sampler..."
              className="w-[240px]"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
