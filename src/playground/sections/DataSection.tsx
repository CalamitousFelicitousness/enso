import { useState } from "react";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { Slider } from "@/components/ui/slider";
import { NumberInput } from "@/components/ui/number-input";
import { ProgressRing } from "@/components/ui/progress-ring";

export function DataSection() {
  // ParamSlider states
  const [steps, setSteps] = useState(20);
  const [cfg, setCfg] = useState(7);
  const [denoise, setDenoise] = useState(0.5);

  // Slider states
  const [sliderVal, setSliderVal] = useState(50);
  const [rangeVal, setRangeVal] = useState([25, 75]);

  // NumberInput state
  const [num, setNum] = useState(42);

  return (
    <section id="data" className="rounded-lg border border-border/50 bg-card p-5 space-y-6">
      <h2 className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
        Data
      </h2>

      {/* ParamSlider */}
      <div className="space-y-4">
        <span className="text-3xs text-muted-foreground/60 uppercase tracking-wider">ParamSlider</span>
        <div className="w-[280px] space-y-2">
          <ParamSlider
            label="Steps"
            value={steps}
            onChange={setSteps}
            min={1}
            max={100}
            step={1}
            defaultValue={20}
            notches={[20, 50]}
          />
          <ParamSlider
            label="CFG Scale"
            value={cfg}
            onChange={setCfg}
            min={0}
            max={30}
            step={0.5}
            defaultValue={7}
          />
          <ParamSlider
            label="Denoise"
            value={denoise}
            onChange={setDenoise}
            min={0}
            max={1}
            step={0.01}
            defaultValue={0.5}
            suffix="%"
          />
        </div>
      </div>

      {/* Slider */}
      <div className="space-y-4">
        <span className="text-3xs text-muted-foreground/60 uppercase tracking-wider">Slider</span>

        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">single</span>
          <div className="flex items-center gap-3 w-[200px]">
            <Slider value={[sliderVal]} onValueChange={([v]) => setSliderVal(v)} min={0} max={100} step={1} />
            <span className="text-3xs font-mono tabular-nums text-muted-foreground w-6 text-right">{sliderVal}</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">range</span>
          <div className="flex items-center gap-3 w-[200px]">
            <Slider value={rangeVal} onValueChange={setRangeVal} min={0} max={100} step={1} />
            <span className="text-3xs font-mono tabular-nums text-muted-foreground w-12 text-right">
              {rangeVal[0]}–{rangeVal[1]}
            </span>
          </div>
        </div>
      </div>

      {/* NumberInput */}
      <div className="space-y-4">
        <span className="text-3xs text-muted-foreground/60 uppercase tracking-wider">NumberInput</span>
        <div className="flex items-center gap-3">
          <NumberInput value={num} onChange={setNum} min={0} max={100} step={1} className="w-20" />
          <span className="text-3xs text-muted-foreground/60">min 0 / max 100</span>
        </div>
      </div>

      {/* ProgressRing */}
      <div className="space-y-4">
        <span className="text-3xs text-muted-foreground/60 uppercase tracking-wider">ProgressRing</span>
        <div className="flex items-center gap-4">
          {[0, 0.25, 0.5, 0.75, 1].map((p) => (
            <div key={p} className="flex flex-col items-center gap-1.5">
              <ProgressRing progress={p} />
              <span className="text-3xs font-mono tabular-nums text-muted-foreground">{Math.round(p * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
