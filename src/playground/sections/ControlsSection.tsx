import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { TextToggle } from "@/components/ui/text-toggle";

export function ControlsSection() {
  // Switch states
  const [pillOn, setPillOn] = useState(false);
  const [pillOff, setPillOff] = useState(true);
  const [pillSmOn, setPillSmOn] = useState(false);
  const [pillSmOff, setPillSmOff] = useState(true);
  const [trackOn, setTrackOn] = useState(false);
  const [trackOff, setTrackOff] = useState(true);
  const [trackLabelOn, setTrackLabelOn] = useState(false);
  const [trackLabelOff, setTrackLabelOff] = useState(true);
  const [splitOn, setSplitOn] = useState(false);
  const [splitOff, setSplitOff] = useState(true);

  // Checkbox states
  const [defaultOn, setDefaultOn] = useState(false);
  const [defaultOff, setDefaultOff] = useState(true);
  const [morphOn, setMorphOn] = useState(false);
  const [morphOff, setMorphOff] = useState(true);
  const [stampOn, setStampOn] = useState(false);
  const [stampOff, setStampOff] = useState(true);
  const [bracketOn, setBracketOn] = useState(false);
  const [bracketOff, setBracketOff] = useState(true);

  // TextToggle states
  const [underlineOn, setUnderlineOn] = useState(false);
  const [underlineOff, setUnderlineOff] = useState(true);

  return (
    <section id="controls" className="rounded-lg border border-border/50 bg-card p-5 space-y-6">
      <h2 className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
        Controls
      </h2>

      {/* Switch variants */}
      <div className="space-y-4">
        <span className="text-3xs text-muted-foreground/60 uppercase tracking-wider">Switch</span>

        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">pill</span>
          <div className="flex items-center gap-3">
            <Switch variant="pill" checked={pillOn} onCheckedChange={setPillOn} />
            <Switch variant="pill" checked={pillOff} onCheckedChange={setPillOff} />
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">pill sm</span>
          <div className="flex items-center gap-3">
            <Switch variant="pill" size="sm" checked={pillSmOn} onCheckedChange={setPillSmOn} />
            <Switch variant="pill" size="sm" checked={pillSmOff} onCheckedChange={setPillSmOff} />
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">track</span>
          <div className="flex items-center gap-3">
            <Switch variant="track" checked={trackOn} onCheckedChange={setTrackOn} className="w-16" />
            <Switch variant="track" checked={trackOff} onCheckedChange={setTrackOff} className="w-16" />
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">track + label</span>
          <div className="flex items-center gap-3">
            <Switch variant="track" label="Label" checked={trackLabelOn} onCheckedChange={setTrackLabelOn} className="w-24" />
            <Switch variant="track" label="Label" checked={trackLabelOff} onCheckedChange={setTrackLabelOff} className="w-24" />
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">split</span>
          <div className="flex items-center gap-3">
            <Switch variant="split" checked={splitOn} onCheckedChange={setSplitOn} />
            <Switch variant="split" checked={splitOff} onCheckedChange={setSplitOff} />
          </div>
        </div>
      </div>

      {/* Checkbox variants */}
      <div className="space-y-4">
        <span className="text-3xs text-muted-foreground/60 uppercase tracking-wider">Checkbox</span>

        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">default</span>
          <div className="flex items-center gap-3">
            <Checkbox variant="default" checked={defaultOn} onCheckedChange={(v) => setDefaultOn(v === true)} />
            <Checkbox variant="default" checked={defaultOff} onCheckedChange={(v) => setDefaultOff(v === true)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">morph</span>
          <div className="flex items-center gap-3">
            <Checkbox variant="morph" checked={morphOn} onCheckedChange={(v) => setMorphOn(v === true)} />
            <Checkbox variant="morph" checked={morphOff} onCheckedChange={(v) => setMorphOff(v === true)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">stamp</span>
          <div className="flex items-center gap-3">
            <Checkbox variant="stamp" checked={stampOn} onCheckedChange={(v) => setStampOn(v === true)} />
            <Checkbox variant="stamp" checked={stampOff} onCheckedChange={(v) => setStampOff(v === true)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">bracket</span>
          <div className="flex items-center gap-3">
            <Checkbox variant="bracket" checked={bracketOn} onCheckedChange={(v) => setBracketOn(v === true)} />
            <Checkbox variant="bracket" checked={bracketOff} onCheckedChange={(v) => setBracketOff(v === true)} />
          </div>
        </div>
      </div>

      {/* TextToggle variants */}
      <div className="space-y-4">
        <span className="text-3xs text-muted-foreground/60 uppercase tracking-wider">TextToggle</span>

        <div className="space-y-1.5">
          <span className="text-3xs text-muted-foreground/60">underline</span>
          <div className="flex items-center gap-3">
            <TextToggle label="Option" checked={underlineOn} onCheckedChange={setUnderlineOn} />
            <TextToggle label="Option" checked={underlineOff} onCheckedChange={setUnderlineOff} />
          </div>
        </div>
      </div>
    </section>
  );
}
