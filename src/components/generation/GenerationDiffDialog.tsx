import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { cn, toDisplayString } from "@/lib/utils";
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
import { useGenerationStore } from "@/stores/generationStore";
import { useModelCapabilities } from "@/hooks/useModelCapabilities";
import { useStrengthSupported } from "@/hooks/useStrengthSupported";
import { asSentHires } from "@/lib/hires";
import {
  applyParams,
  pickOf,
  recordTarget,
  restoreInputs,
  restoreSettings,
  restoreSettingsAndInputs,
  resultTarget,
  type ModelPick,
  type RestoreTarget,
} from "@/lib/request/restore";
import { useModelList } from "@/api/hooks/useModels";
import { checkpointState, type ModelState } from "@/lib/recipes/models";
import { entryTarget } from "@/inputs/recipes";
import { FindModelDialog } from "@/components/aside/tabs/library/FindModelDialog";
import { useModelHashStore } from "@/stores/modelHashStore";
import {
  FIND_ON_CIVITAI,
  modelStateLongText,
  READING_RECIPE,
  RESTORE_MODEL,
  skippedSettingsText,
} from "@/lib/recipes/text";
import { RETRY } from "@/lib/media/text";
import type { RestoreSource } from "@/stores/restoreDialogStore";
import type { GenerationState } from "@/stores/generationStore";
import { useJobFact } from "@/hooks/useJobFact";
import { hasLegacyInputs } from "@/inputs/legacyResult";
import { resultActions } from "@/lib/jobs/cardActions";
import {
  INPUTS_FROM_RECORD,
  READ_FAILED,
  READING_JOB,
  reasonText,
  RESTORE_DIALOG_WORDS,
  settingsDifferText,
  slotWords,
} from "@/lib/jobs/text";

interface GenerationDiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: RestoreSource | null;
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

export function GenerationDiffDialog({ open, onOpenChange, source }: GenerationDiffDialogProps) {
  const words = RESTORE_DIALOG_WORDS[source?.kind ?? "result"];
  const sourceKey = !source
    ? ""
    : source.kind === "result"
      ? `${source.resultId}:${source.imageIndex}`
      : source.kind === "job"
        ? source.jobId
        : `entry:${source.id}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{words.title}</DialogTitle>
          <DialogDescription className="sr-only">{words.description}</DialogDescription>
        </DialogHeader>
        {/* keyed so the picks start over for each source and each opening */}
        {source && (
          <RestoreBody
            key={`${open}:${sourceKey}`}
            source={source}
            onClose={() => onOpenChange(false)}
          />
        )}
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

/** The model row: a switch named by its label and described by the model and
 * its state, kept outside a label so a button can sit beside it. */
function ModelRow({
  name,
  state,
  checked,
  onCheckedChange,
  onFind,
}: {
  name: string;
  state: ModelState;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  onFind: () => void;
}) {
  const id = useId();
  const findable = state === "missing" || state === "otherFile";
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 px-2 py-1">
      <Switch
        className="row-span-2"
        size="sm"
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-words`}
        checked={checked}
        disabled={state === "missing"}
        onCheckedChange={onCheckedChange}
      />
      <span id={`${id}-label`} className="text-2xs">
        {RESTORE_MODEL}
      </span>
      <Button
        variant="outline"
        size="xs"
        className={cn("row-span-2", !findable && "invisible")}
        tabIndex={findable ? undefined : -1}
        onClick={onFind}
      >
        {FIND_ON_CIVITAI}
      </Button>
      <span id={`${id}-words`} className="col-start-2 text-3xs leading-tight text-muted-foreground">
        {name} · {modelStateLongText(state)}
      </span>
    </div>
  );
}

/** The Settings row's words: how many differ, and what this build could not read. */
function settingsWords(changed: number, target: RestoreTarget | null): string {
  const skipped = target?.settings.ok ? target.settings.skipped : 0;
  const differ = settingsDifferText(changed);
  return skipped > 0 ? `${differ}. ${skippedSettingsText(skipped)}` : differ;
}

type Resolved =
  { state: "reading" } | { state: "failed" } | { state: "ready"; target: RestoreTarget };

/** The source's target, read once per opening; Retry reads it again. A
 * result is read by its id, so the strip updating it does not read it twice. */
function useTarget(source: RestoreSource) {
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<{ attempt: number; resolved: Resolved } | null>(null);
  useEffect(() => {
    let live = true;
    const current =
      source.kind === "result"
        ? useGenerationStore.getState().results.find((r) => r.id === source.resultId)
        : undefined;
    const reading =
      source.kind === "entry"
        ? entryTarget(source.id)
        : source.kind === "job"
          ? recordTarget(source.jobId)
          : current
            ? resultTarget(current, source.imageIndex)
            : Promise.reject(new Error("the result is no longer on the strip"));
    reading.then(
      (target) => live && setAnswer({ attempt, resolved: { state: "ready", target } }),
      () => live && setAnswer({ attempt, resolved: { state: "failed" } }),
    );
    return () => {
      live = false;
    };
  }, [source, attempt]);
  const resolved: Resolved = answer?.attempt === attempt ? answer.resolved : { state: "reading" };
  return { resolved, retry: () => setAttempt((n) => n + 1) };
}

function RestoreBody({ source, onClose }: { source: RestoreSource; onClose: () => void }) {
  const storeState = useGenerationStore();
  const result = useGenerationStore((s) =>
    source.kind === "result" ? (s.results.find((r) => r.id === source.resultId) ?? null) : null,
  );
  const jobId = source.kind === "job" ? source.jobId : result?.jobId;
  const facts = useJobFact(jobId);
  const { resolved, retry } = useTarget(source);
  const target = resolved.state === "ready" ? resolved.target : null;
  const { data: installed } = useModelList();
  const [finding, setFinding] = useState(false);
  // a pick left null takes the default: on where the restore can act
  const [picks, setPicks] = useState<{
    settings: boolean | null;
    inputs: boolean | null;
    model: boolean | null;
  }>({ settings: null, inputs: null, model: null });

  const resultParams = useMemo(
    () => (target?.settings.ok ? target.settings.extracted.params : {}),
    [target],
  );

  const pixelInput = useModelCapabilities().requestSetsSize === true;
  const strengthSupported = useStrengthSupported();

  const groupedRows = useMemo(() => {
    const mapped = resultParams as Record<string, unknown>;
    // compared as the builder sends them, so a hires value it rewrites is no change
    const support = { pixelInput, strength: strengthSupported };
    const current = asSentHires(storeState as unknown as Record<string, unknown>, support);
    const sent = asSentHires(mapped, support);

    return DIFF_GROUPS.map((group) => {
      const rows: DiffRow[] = group.keys
        .filter((k) => k in mapped)
        .map((k) => {
          const keys = [k, ...(LINKED[k] ?? [])];
          const cur = Object.fromEntries(keys.map((key) => [key, current[key]]));
          const res = Object.fromEntries(keys.map((key) => [key, sent[key]]));
          return {
            key: k,
            current: shown(k, cur),
            result: shown(k, res),
            apply: Object.fromEntries(keys.map((key) => [key, mapped[key]])),
            changed: JSON.stringify(cur) !== JSON.stringify(res),
          };
        });
      const changedCount = rows.filter((r) => r.changed).length;
      return { ...group, rows, changedCount };
    }).filter((g) => g.changedCount > 0);
  }, [storeState, resultParams, pixelInput, strengthSupported]);

  const totalChanged = groupedRows.reduce((sum, g) => sum + g.changedCount, 0);

  const slots = resultActions(
    {
      jobId: jobId ?? null,
      type: result?.type ?? null,
      legacyInputs: result ? hasLegacyInputs(result) : false,
    },
    facts,
  );
  const settingsReason =
    target && !target.settings.ok
      ? reasonText(target.settings.reason)
      : slotWords(slots.restoreSettings).reason;
  const inputsWords =
    target?.inputsReason !== undefined
      ? { reason: target.inputsReason && reasonText(target.inputsReason), note: null }
      : slotWords(slots.restoreInputs);
  const ready = target !== null;
  const settingsAvailable = ready && settingsReason === null && totalChanged > 0;
  const inputsAvailable = ready && inputsWords.reason === null;
  const settingsOn = settingsAvailable && (picks.settings ?? true);
  const inputsOn = inputsAvailable && (picks.inputs ?? true);

  const model = target?.model ?? null;
  const downloads = useModelHashStore((s) => s.downloads);
  const modelFact = model && installed ? checkpointState(model, installed, downloads) : null;
  const modelOn =
    settingsOn &&
    modelFact !== null &&
    modelFact.state !== "missing" &&
    (picks.model ?? modelFact.state === "installed");

  const handleRestore = useCallback(() => {
    if (!target) return;
    const pick: ModelPick | null = !settingsOn
      ? null
      : modelOn && modelFact?.match
        ? pickOf(modelFact.match)
        : modelFact?.state === "missing" && model
          ? { kind: "missing", name: model.name }
          : null;
    if (settingsOn && inputsOn) void restoreSettingsAndInputs(target, pick);
    else if (settingsOn) restoreSettings(target, pick);
    else if (inputsOn) void restoreInputs(target);
    onClose();
  }, [target, settingsOn, inputsOn, modelOn, modelFact, model, onClose]);

  const handleApplyOne = useCallback((row: DiffRow) => {
    applyParams(row.apply, `${labelOf(row.key)} applied`);
  }, []);

  const words = RESTORE_DIALOG_WORDS[source.kind];
  return (
    <>
      <p className="-mt-2 truncate text-2xs text-muted-foreground" title={target?.name}>
        {resolved.state === "reading"
          ? source.kind === "entry"
            ? READING_RECIPE
            : READING_JOB
          : (target?.name ?? "")}
      </p>
      {resolved.state === "failed" && (
        <div className="flex items-center gap-2 text-2xs text-destructive" role="alert">
          {READ_FAILED}
          <Button variant="outline" size="xs" onClick={retry}>
            {RETRY}
          </Button>
        </div>
      )}
      <div className="flex flex-col border-b border-border/50 pb-1">
        {model && modelFact && (
          <ModelRow
            name={model.name}
            state={modelFact.state}
            checked={modelOn}
            onCheckedChange={(on) => setPicks((p) => ({ ...p, model: on }))}
            onFind={() => setFinding(true)}
          />
        )}
        <PickRow
          label="Settings"
          words={settingsReason ?? settingsWords(totalChanged, target)}
          checked={settingsOn}
          disabled={!settingsAvailable}
          onCheckedChange={(settings) => setPicks((p) => ({ ...p, settings }))}
        />
        <PickRow
          label="Inputs"
          words={inputsWords.reason ?? inputsWords.note ?? INPUTS_FROM_RECORD}
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
                <th className="py-1 px-2 font-medium">{words.column}</th>
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
      {model && modelFact && (
        <FindModelDialog
          open={finding}
          onOpenChange={setFinding}
          items={[
            {
              key: "checkpoint",
              kind: "checkpoint",
              name: model.name,
              state: modelFact.state,
              sha256: model.sha256,
              shorthash: model.shorthash,
            },
          ]}
        />
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
