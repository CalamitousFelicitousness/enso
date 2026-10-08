import { useMemo, useCallback } from "react";
import { ArrowRight } from "lucide-react";
import { toDisplayString } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useGenerationStore, type GenerationResult } from "@/stores/generationStore";
import { applyParams } from "@/lib/request/restore";
import { extractParams, resultSettings } from "@/lib/request/restoreParams";
import type { GenerationState } from "@/stores/generationStore";

interface GenerationDiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: GenerationResult | null;
  /** The image of the result whose seed is compared. */
  imageIndex?: number;
}

/** What each compared setting is called where it is set. */
const LABELS: Partial<Record<keyof GenerationState, string>> = {
  prompt: "Prompt",
  negativePrompt: "Negative prompt",
  sampler: "Sampler",
  steps: "Steps",
  width: "Width",
  height: "Height",
  batchSize: "Batch size",
  batchCount: "Batch count",
  cfgScale: "Guidance scale",
  cfgEnd: "Guidance end",
  guidanceRescale: "Rescale",
  imageCfgScale: "Refine guidance scale",
  pagScale: "Attention guidance",
  pagAdaptive: "Adaptive",
  seed: "Seed",
  subseed: "Variation seed",
  subseedStrength: "Variation strength",
  denoisingStrength: "Denoise",
  hiresEnabled: "Hires",
  hiresUpscaler: "Hires upscaler",
  hiresScale: "Hires scale",
  hiresSteps: "Hires steps",
  hiresDenoising: "Hires denoise",
  hiresResizeMode: "Hires size mode",
  hiresSampler: "Hires sampler",
  hiresForce: "Force hires",
  hiresResizeX: "Hires width",
  hiresResizeY: "Hires height",
  hiresResizeContext: "Hires context",
  refinerStart: "Refiner start",
  refinerSteps: "Refiner steps",
  refinerPrompt: "Refine prompt",
  refinerNegative: "Refine negative",
  sigmaMethod: "Sigma",
  timestepSpacing: "Spacing",
  betaSchedule: "Beta",
  predictionMethod: "Prediction",
  flowShift: "Flow shift",
  baseShift: "Base shift",
  maxShift: "Max shift",
  sigmaAdjust: "Sigma adjust",
  sigmaAdjustStart: "Sigma adjust start",
  sigmaAdjustEnd: "Sigma adjust end",
  thresholding: "Thresholding",
  dynamic: "Dynamic shift",
  rescale: "Rescale betas",
  lowOrder: "Low order",
  timestepsOverride: "Timesteps override",
  timestepsPreset: "Timesteps preset",
  clipSkip: "CLIP skip",
  vaeType: "VAE type",
  tiling: "Texture tiling",
  hidiffusion: "HiDiffusion",
  freeuEnabled: "FreeU",
  freeuB1: "FreeU B1",
  freeuB2: "FreeU B2",
  freeuS1: "FreeU S1",
  freeuS2: "FreeU S2",
  hypertileUnetEnabled: "HyperTile UNet",
  hypertileHiresOnly: "HyperTile hires only",
  hypertileUnetTile: "HyperTile UNet tile",
  hypertileUnetMinTile: "HyperTile UNet min tile",
  hypertileUnetSwapSize: "HyperTile UNet swap size",
  hypertileUnetDepth: "HyperTile UNet depth",
  hypertileVaeEnabled: "HyperTile VAE",
  hypertileVaeTile: "HyperTile VAE tile",
  hypertileVaeSwapSize: "HyperTile VAE swap size",
  teacacheEnabled: "TeaCache",
  teacacheThresh: "TeaCache threshold",
  tokenMergingMethod: "Token merging",
  tomeRatio: "ToMe ratio",
  todoRatio: "ToDo ratio",
  detailerEnabled: "Detailer",
  detailerOnly: "Detail only",
  detailerDefaults: "Detailer settings",
  detailerModels: "Detailer models",
  hdrMode: "Latent correction mode",
  hdrBrightness: "Latent brightness",
  hdrSharpen: "Latent sharpen",
  hdrColor: "Latent color",
  hdrClamp: "Latent clamp",
  hdrBoundary: "Latent range",
  hdrThreshold: "Latent threshold",
  hdrMaximize: "Latent maximize",
  hdrMaxCenter: "Latent center",
  hdrMaxBoundary: "Latent max range",
  hdrColorPicker: "Latent tint color",
  hdrTintRatio: "Latent tint strength",
  gradingBrightness: "Brightness",
  gradingContrast: "Contrast",
  gradingSaturation: "Saturation",
  gradingHue: "Hue",
  gradingGamma: "Gamma",
  gradingSharpness: "Sharpness",
  gradingColorTemp: "Color temp (K)",
  gradingShadows: "Shadows",
  gradingMidtones: "Midtones",
  gradingHighlights: "Highlights",
  gradingClaheClip: "CLAHE clip",
  gradingClaheGrid: "CLAHE grid",
  gradingShadowsTint: "Shadows tint",
  gradingHighlightsTint: "Highlights tint",
  gradingSplitToneBalance: "Split tone balance",
  gradingVignette: "Vignette",
  gradingGrain: "Grain",
  gradingLutFile: "Color LUT",
  gradingLutStrength: "Color LUT strength",
};

const labelOf = (key: string) => LABELS[key as keyof GenerationState] ?? key;

interface DiffGroup {
  label: string;
  keys: (keyof GenerationState)[];
}

const DIFF_GROUPS: DiffGroup[] = [
  { label: "Prompt", keys: ["prompt", "negativePrompt"] },
  {
    label: "Core",
    keys: ["sampler", "steps", "width", "height", "batchSize", "batchCount"],
  },
  {
    label: "Guidance",
    keys: [
      "cfgScale",
      "cfgEnd",
      "guidanceRescale",
      "imageCfgScale",
      "pagScale",
      "pagAdaptive",
      "seed",
      "subseed",
      "subseedStrength",
      "denoisingStrength",
    ],
  },
  {
    label: "Hires",
    keys: [
      "hiresEnabled",
      "hiresUpscaler",
      "hiresScale",
      "hiresSteps",
      "hiresDenoising",
      "hiresResizeMode",
      "hiresSampler",
      "hiresForce",
      "hiresResizeX",
      "hiresResizeY",
      "hiresResizeContext",
    ],
  },
  {
    label: "Refiner",
    keys: ["refinerStart", "refinerSteps", "refinerPrompt", "refinerNegative"],
  },
  {
    label: "Scheduler",
    keys: [
      "sigmaMethod",
      "timestepSpacing",
      "betaSchedule",
      "predictionMethod",
      "flowShift",
      "baseShift",
      "maxShift",
      "sigmaAdjust",
      "sigmaAdjustStart",
      "sigmaAdjustEnd",
      "thresholding",
      "dynamic",
      "rescale",
      "lowOrder",
      "timestepsOverride",
      "timestepsPreset",
    ],
  },
  {
    label: "Advanced",
    keys: [
      "clipSkip",
      "vaeType",
      "tiling",
      "hidiffusion",
      "freeuEnabled",
      "freeuB1",
      "freeuB2",
      "freeuS1",
      "freeuS2",
      "hypertileUnetEnabled",
      "hypertileHiresOnly",
      "hypertileUnetTile",
      "hypertileUnetMinTile",
      "hypertileUnetSwapSize",
      "hypertileUnetDepth",
      "hypertileVaeEnabled",
      "hypertileVaeTile",
      "hypertileVaeSwapSize",
      "teacacheEnabled",
      "teacacheThresh",
      "tokenMergingMethod",
      "tomeRatio",
      "todoRatio",
    ],
  },
  {
    label: "Detailer",
    keys: ["detailerEnabled", "detailerOnly", "detailerDefaults", "detailerModels"],
  },
  {
    label: "Latent Corrections",
    keys: [
      "hdrMode",
      "hdrBrightness",
      "hdrSharpen",
      "hdrColor",
      "hdrClamp",
      "hdrBoundary",
      "hdrThreshold",
      "hdrMaximize",
      "hdrMaxCenter",
      "hdrMaxBoundary",
      "hdrColorPicker",
      "hdrTintRatio",
    ],
  },
  {
    label: "Color Grading",
    keys: [
      "gradingBrightness",
      "gradingContrast",
      "gradingSaturation",
      "gradingHue",
      "gradingGamma",
      "gradingSharpness",
      "gradingColorTemp",
      "gradingShadows",
      "gradingMidtones",
      "gradingHighlights",
      "gradingClaheClip",
      "gradingClaheGrid",
      "gradingShadowsTint",
      "gradingHighlightsTint",
      "gradingSplitToneBalance",
      "gradingVignette",
      "gradingGrain",
      "gradingLutFile",
      "gradingLutStrength",
    ],
  },
];

interface DiffRow {
  key: string;
  current: unknown;
  result: unknown;
  changed: boolean;
}

function formatValue(v: unknown): string {
  if (v === undefined || v === null) return "-";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string") return v || '""';
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === "string" || typeof x === "number")) {
      return v.join(", ");
    }
    return JSON.stringify(v);
  }
  if (typeof v === "object") return JSON.stringify(v);
  return toDisplayString(v);
}

export function GenerationDiffDialog({
  open,
  onOpenChange,
  result,
  imageIndex = 0,
}: GenerationDiffDialogProps) {
  const storeState = useGenerationStore();

  const resultParams = useMemo(() => {
    const settings = result ? resultSettings(result, imageIndex) : null;
    return settings?.ok ? extractParams(settings.source).params : {};
  }, [result, imageIndex]);

  const groupedRows = useMemo(() => {
    const current = storeState as unknown as Record<string, unknown>;
    const mapped = resultParams as Record<string, unknown>;

    return DIFF_GROUPS.map((group) => {
      const rows: DiffRow[] = group.keys
        .filter((k) => k in mapped)
        .map((k) => {
          const cur = current[k];
          const res = mapped[k];
          return {
            key: k,
            current: cur,
            result: res,
            changed: JSON.stringify(cur) !== JSON.stringify(res),
          };
        });
      const changedCount = rows.filter((r) => r.changed).length;
      return { ...group, rows, changedCount };
    }).filter((g) => g.changedCount > 0);
  }, [storeState, resultParams]);

  const totalChanged = groupedRows.reduce((sum, g) => sum + g.changedCount, 0);

  const handleApplyAll = useCallback(() => {
    const updates: Record<string, unknown> = {};
    for (const group of groupedRows) {
      for (const row of group.rows) {
        if (row.changed) updates[row.key] = row.result;
      }
    }
    applyParams(updates, `${totalChanged} setting${totalChanged !== 1 ? "s" : ""} applied`);
    onOpenChange(false);
  }, [groupedRows, totalChanged, onOpenChange]);

  const handleApplyOne = useCallback((key: string, value: unknown) => {
    applyParams({ [key]: value }, `${labelOf(key)} applied`);
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Compare Settings ({totalChanged} changed)</DialogTitle>
          <DialogDescription className="sr-only">
            Side-by-side comparison of generation parameters
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <table className="w-full text-2xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1 px-2 font-medium">Parameter</th>
                <th className="py-1 px-2 font-medium">Current</th>
                <th className="py-1 px-2 font-medium">Result</th>
                <th className="py-1 px-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {groupedRows.map((group) => (
                <GroupSection
                  key={group.label}
                  label={group.label}
                  changedCount={group.changedCount}
                  rows={group.rows}
                  onApplyOne={handleApplyOne}
                />
              ))}
            </tbody>
          </table>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={handleApplyAll} disabled={totalChanged === 0}>
            Apply All ({totalChanged})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GroupSection({
  label,
  changedCount,
  rows,
  onApplyOne,
}: {
  label: string;
  changedCount: number;
  rows: DiffRow[];
  onApplyOne: (key: string, value: unknown) => void;
}) {
  return (
    <>
      <tr className="border-t border-border/50">
        <td
          colSpan={4}
          className="py-1 px-2 font-medium text-muted-foreground text-2xs uppercase tracking-wider"
        >
          {label} ({changedCount})
        </td>
      </tr>
      {rows.map((row) => (
        <tr key={row.key} className={row.changed ? "bg-amber-500/10" : "text-muted-foreground/60"}>
          <td className="py-0.5 px-2" title={row.key}>
            {labelOf(row.key)}
          </td>
          <td className="py-0.5 px-2 max-w-32 truncate">{formatValue(row.current)}</td>
          <td className="py-0.5 px-2 max-w-32 truncate font-medium">{formatValue(row.result)}</td>
          <td className="py-0.5 px-1">
            {row.changed && (
              <button
                type="button"
                onClick={() => onApplyOne(row.key, row.result)}
                className="hover:text-primary"
                title="Apply this value"
              >
                <ArrowRight size={12} />
              </button>
            )}
          </td>
        </tr>
      ))}
    </>
  );
}
