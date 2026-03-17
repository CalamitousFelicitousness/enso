import { TooltipProvider } from "@/components/ui/tooltip";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { usePlaygroundTheme } from "./usePlaygroundTheme";
import { ControlsSection } from "./sections/ControlsSection";
import { NavigationSection } from "./sections/NavigationSection";
import { LayoutSection } from "./sections/LayoutSection";
import { DataSection } from "./sections/DataSection";
import { InputsSection } from "./sections/InputsSection";
import { ButtonsSection } from "./sections/ButtonsSection";
import { OverlaysSection } from "./sections/OverlaysSection";
import { PanelsSection } from "./sections/PanelsSection";

const sections = [
  { id: "panels", label: "Panels" },
  { id: "controls", label: "Controls" },
  { id: "navigation", label: "Navigation" },
  { id: "layout", label: "Layout" },
  { id: "data", label: "Data" },
  { id: "inputs", label: "Inputs" },
  { id: "buttons", label: "Buttons" },
  { id: "overlays", label: "Overlays" },
] as const;

const themeModes = [
  { value: "dark" as const, label: "Dark" },
  { value: "light" as const, label: "Light" },
  { value: "system" as const, label: "System" },
];

export function PlaygroundApp() {
  const theme = usePlaygroundTheme();

  return (
    <TooltipProvider delayDuration={300} skipDelayDuration={300}>
      <div className="min-h-screen bg-background text-foreground">
        {/* Header */}
        <header className="sticky top-0 z-[100] bg-background border-b border-border/50 px-6 py-3 space-y-3">
          <div className="flex items-center gap-6">
            <h1 className="text-sm font-medium tracking-wide shrink-0">
              Enso Playground
            </h1>

            {/* Theme mode */}
            <SegmentedControl
              options={themeModes}
              value={theme.colorMode}
              onValueChange={theme.setColorMode}
              variant="dense"
              animated
            />

            {/* Accent color */}
            <div className="flex items-center gap-2">
              <span className="text-3xs text-muted-foreground/60 uppercase tracking-wider">Accent</span>
              <input
                type="color"
                value={theme.accentColor}
                onChange={(e) => theme.setAccentColor(e.target.value)}
                className="w-6 h-6 rounded cursor-pointer border border-border/50 bg-transparent [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-none"
              />
            </div>

            {/* UI scale */}
            <div className="flex items-center gap-2">
              <span className="text-3xs text-muted-foreground/60 uppercase tracking-wider">Scale</span>
              <input
                type="range"
                min={8}
                max={28}
                step={1}
                value={theme.uiScale}
                onChange={(e) => theme.setUiScale(Number(e.target.value))}
                className="w-20 accent-primary"
              />
              <span className="text-3xs font-mono text-muted-foreground tabular-nums w-6 text-right">
                {theme.uiScale}
              </span>
            </div>
          </div>

          {/* Section nav */}
          <nav className="flex gap-3">
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="text-3xs text-muted-foreground/50 hover:text-muted-foreground transition-colors uppercase tracking-wider"
              >
                {s.label}
              </a>
            ))}
          </nav>
        </header>

        {/* Sections */}
        <main className="p-6 space-y-6 max-w-[1400px] mx-auto">
          <PanelsSection />
          <ControlsSection />
          <NavigationSection />
          <LayoutSection />
          <DataSection />
          <InputsSection />
          <ButtonsSection />
          <OverlaysSection />
        </main>
      </div>
    </TooltipProvider>
  );
}
