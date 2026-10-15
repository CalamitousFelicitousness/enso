import { useCallback, useId, useMemo, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { useGenerationStore, type GenerationResult } from "@/stores/generationStore";
import {
  applyParams,
  restoreInputs,
  restoreSettings,
  restoreSettingsAndInputs,
  resultTarget,
} from "@/lib/request/restore";
import { extractParams, resultSettings } from "@/lib/request/restoreParams";
import type { GenerationState } from "@/stores/generationStore";
import { useJobFact } from "@/hooks/useJobFact";
import { hasLegacyInputs } from "@/inputs/legacyResult";
import { resultActions } from "@/lib/jobs/cardActions";
import {
  INPUTS_FROM_RECORD,
  RESTORE_DIALOG_TITLE,
  settingsDifferText,
  slotWords,
} from "@/lib/jobs/text";

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

/** Keys a row carries with its own, compared and applied together. */
const LINKED: Partial<Record<string, readonly string[]>> = {
  // a LUT is its file's name and the hash of its bytes; one without the other names another file
  gradingLutFile: ["gradingLutHash"],
};

/** What a row shows of its keys' values. */
function shown(key: string, values: Record<string, unknown>): unknown {
  const hash = values["gradingLutHash"];
  if (key === "gradingLutFile" && typeof hash === "string") {
    return `${toDisplayString(values[key])} (${hash.slice(0, 8)})`;
  }
  return values[key];
}

interface DiffRow {
  key: string;
  current: unknown;
  result: unknown;
  /** The result's values of the row's keys. */
  apply: Record<string, unknown>;
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{RESTORE_DIALOG_TITLE}</DialogTitle>
          <DialogDescription className="sr-only">
            What restoring the result's settings and inputs would change
          </DialogDescription>
        </DialogHeader>
        {/* keyed so the picks start over for each result and each opening */}
        <RestoreBody
          key={`${open}:${result?.id ?? ""}:${imageIndex}`}
          result={result}
          imageIndex={imageIndex}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

/** A row of the dialog's picks: what a restore takes, with why it cannot. */
function PickRow({
  label,
  words,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  words: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="grid grid-cols-[auto_1fr] items-center gap-x-3 px-2 py-1">
      <Switch
        id={id}
        className="row-span-2"
        size="sm"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
      <span className="text-2xs">{label}</span>
      <span className="col-start-2 text-3xs leading-tight text-muted-foreground">{words}</span>
    </label>
  );
}

function RestoreBody({
  result,
  imageIndex,
  onClose,
}: {
  result: GenerationResult | null;
  imageIndex: number;
  onClose: () => void;
}) {
  const storeState = useGenerationStore();
  const facts = useJobFact(result?.jobId);
  // a pick left null takes the default: on where the restore can act
  const [picks, setPicks] = useState<{ settings: boolean | null; inputs: boolean | null }>({
    settings: null,
    inputs: null,
  });

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
          const keys = [k, ...(LINKED[k] ?? [])];
          const cur = Object.fromEntries(keys.map((key) => [key, current[key]]));
          const res = Object.fromEntries(keys.map((key) => [key, mapped[key]]));
          return {
            key: k,
            current: shown(k, cur),
            result: shown(k, res),
            apply: res,
            changed: JSON.stringify(cur) !== JSON.stringify(res),
          };
        });
      const changedCount = rows.filter((r) => r.changed).length;
      return { ...group, rows, changedCount };
    }).filter((g) => g.changedCount > 0);
  }, [storeState, resultParams]);

  const totalChanged = groupedRows.reduce((sum, g) => sum + g.changedCount, 0);

  const slots = result
    ? resultActions(
        {
          jobId: result.jobId ?? null,
          type: result.type ?? null,
          legacyInputs: hasLegacyInputs(result),
        },
        facts,
      )
    : null;
  const settingsWords = slots ? slotWords(slots.restoreSettings) : null;
  const inputsWords = slots ? slotWords(slots.restoreInputs) : null;
  const settingsAvailable = settingsWords?.reason === null && totalChanged > 0;
  const inputsAvailable = inputsWords?.reason === null;
  const settingsOn = settingsAvailable && (picks.settings ?? true);
  const inputsOn = inputsAvailable && (picks.inputs ?? true);

  const handleRestore = useCallback(() => {
    if (!result) return;
    const target = resultTarget(result, imageIndex);
    if (settingsOn && inputsOn) void restoreSettingsAndInputs(target);
    else if (settingsOn) restoreSettings(target);
    else if (inputsOn) void restoreInputs(target);
    onClose();
  }, [result, imageIndex, settingsOn, inputsOn, onClose]);

  const handleApplyOne = useCallback((row: DiffRow) => {
    applyParams(row.apply, `${labelOf(row.key)} applied`);
  }, []);

  return (
    <>
      <div className="flex flex-col border-b border-border/50 pb-1">
        <PickRow
          label="Settings"
          words={settingsWords?.reason ?? settingsDifferText(totalChanged)}
          checked={settingsOn}
          disabled={!settingsAvailable}
          onCheckedChange={(settings) => setPicks((p) => ({ ...p, settings }))}
        />
        <PickRow
          label="Inputs"
          words={inputsWords?.reason ?? inputsWords?.note ?? INPUTS_FROM_RECORD}
          checked={inputsOn}
          disabled={!inputsAvailable}
          onCheckedChange={(inputs) => setPicks((p) => ({ ...p, inputs }))}
        />
      </div>
      {groupedRows.length > 0 && (
        <ScrollArea className="max-h-[50vh]">
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
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button onClick={handleRestore} disabled={!settingsOn && !inputsOn}>
          Restore
        </Button>
      </DialogFooter>
    </>
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
  onApplyOne: (row: DiffRow) => void;
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
                onClick={() => onApplyOne(row)}
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
