// The settings of a Control or IP-Adapter frame: which model runs on its
// picture, how strongly and when, the processor sdnext applies first, and
// for an IP-Adapter frame its adapter, scale and region masks.

import { useCallback, useMemo } from "react";
import { X, Play, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  useControlModels,
  useControlModes,
  usePreprocessImage,
  usePreprocessors,
} from "@/api/hooks/useControl";
import { useIPAdapterModels } from "@/api/hooks/useAdapters";
import { uploadFile } from "@/lib/upload";
import { base64ToBlob } from "@/lib/utils";
import { buildProcessorGroups } from "@/lib/processorUtils";
import { ParamSlider } from "../../ParamSlider";
import { SectionLeader } from "@/components/ui/section-leader";
import { ParamGrid } from "../../ParamRow";
import { ImageUpload } from "../../ImageUpload";
import { Switch } from "@/components/ui/switch";
import { ParamLabel } from "../../ParamLabel";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { useInputStore, type NewPicture } from "@/stores/inputStore";
import { imageSize, useBlobUrl } from "@/inputs/media";
import { addFilesToInputs } from "@/inputs/route";
import { useOutline } from "@/inputs/useOutline";
import { controlTypeLabel, positionLabel } from "@/lib/inputs/text";
import {
  composedPictures,
  isComposed,
  type ControlType,
  type FitPolicy,
  type Frame,
  type JsonValue,
  type Picture,
} from "@/lib/inputs/types";

const COLORMAPS = [
  "None",
  "autumn",
  "bone",
  "jet",
  "winter",
  "rainbow",
  "ocean",
  "summer",
  "spring",
  "cool",
  "hsv",
  "pink",
  "hot",
  "parula",
  "magma",
  "inferno",
  "plasma",
  "viridis",
  "cividis",
  "twilight",
  "shifted",
  "turbo",
  "deepgreen",
];

const STRING_PARAM_OPTIONS: Record<string, string[]> = {
  color_map: COLORMAPS,
};

const CONTROL_TYPES: ControlType[] = ["controlnet", "t2i", "xs", "lite", "style_transfer"];

/** The fit a Control frame lays its picture out with; "by hand" leaves it where it is. */
const FITS: { value: string; label: string }[] = [
  { value: "contain", label: "Fit inside" },
  { value: "cover", label: "Fill, crop" },
  { value: "fill", label: "Stretch" },
  { value: "free", label: "By hand" },
];

/** Infer reasonable slider range from a default value when the API provides no metadata. */
function inferSliderRange(defaultValue: number): {
  min: number;
  max: number;
  step: number;
} {
  if (Number.isInteger(defaultValue)) {
    if (defaultValue <= 1) return { min: 0, max: 10, step: 1 };
    if (defaultValue <= 64) return { min: 0, max: Math.max(512, defaultValue * 4), step: 1 };
    if (defaultValue <= 512) return { min: 0, max: Math.max(2048, defaultValue * 4), step: 1 };
    return { min: 0, max: defaultValue * 4, step: 1 };
  }
  if (defaultValue <= 1) return { min: 0, max: 2, step: 0.01 };
  return { min: 0, max: Math.max(10, defaultValue * 4), step: 0.01 };
}

async function toNewPicture(file: File): Promise<NewPicture> {
  const snapshot = new File([await file.arrayBuffer()], file.name, { type: file.type });
  const { width, height } = await imageSize(snapshot);
  return { file: snapshot, name: file.name, width, height };
}

/** The picture a Control frame's processor would run on: its own composite's
 * base, or its link's target's. Null without one or when its bytes are gone. */
function sourcePicture(frames: Frame[], frame: Frame): Picture | null {
  const source = frame.link ? frames.find((f) => f.id === frame.link?.frameId) : frame;
  if (!source || !isComposed(source.role)) return null;
  return composedPictures(source)[0] ?? null;
}

interface ControlFrameControlsProps {
  frameId: string;
  compact?: boolean;
}

export function ControlFrameControls({ frameId, compact }: ControlFrameControlsProps) {
  const frame = useInputStore((s) => s.frames.find((f) => f.id === frameId));
  const frames = useInputStore((s) => s.frames);
  const patchControl = useInputStore((s) => s.patchControl);
  const patchIpAdapter = useInputStore((s) => s.patchIpAdapter);
  const setFit = useInputStore((s) => s.setFit);
  const setLink = useInputStore((s) => s.setLink);
  const setProcessed = useInputStore((s) => s.setProcessed);
  const removePicture = useInputStore((s) => s.removePicture);
  const addIpMask = useInputStore((s) => s.addIpMask);
  const removeIpMask = useInputStore((s) => s.removeIpMask);
  const outline = useOutline();
  const type = frame?.control.type ?? "controlnet";
  const { data: models } = useControlModels(type);
  const { data: controlModes } = useControlModes();
  const { data: preprocessors } = usePreprocessors();
  const { data: adapterModels } = useIPAdapterModels();
  const preprocessMutation = usePreprocessImage();

  const control = frame?.control;
  const source = frame ? sourcePicture(frames, frame) : null;

  const handleProcess = useCallback(async () => {
    if (!frame || !control || !source?.file || control.process === "None") return;
    try {
      const ref = await uploadFile(
        new File([source.file], source.name, { type: source.file.type }),
      );
      const params =
        Object.keys(control.processParams).length > 0 ? control.processParams : undefined;
      const result = await preprocessMutation.mutateAsync({
        image: ref,
        model: control.process,
        params,
      });
      const blob = base64ToBlob(result.image, "image/png");
      const { width, height } = await imageSize(blob);
      setProcessed(frame.id, { cid: crypto.randomUUID(), blob, width, height });
    } catch (err) {
      toast.error("Preprocessing failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [frame, control, source, preprocessMutation, setProcessed]);

  const processorGroups = useMemo(
    () => (preprocessors ? buildProcessorGroups(preprocessors) : []),
    [preprocessors],
  );

  // Default params for the selected processor
  const processorDefaults = useMemo(() => {
    if (!preprocessors || !control || control.process === "None") return null;
    const info = preprocessors.find((p) => p.name === control.process);
    if (!info || Object.keys(info.params).length === 0) return null;
    return info.params;
  }, [preprocessors, control]);

  const handleProcessorChange = useCallback(
    (process: string) => {
      if (!frame) return;
      // the map was made by the processor before; the new one starts from the API's defaults
      const info = preprocessors?.find((p) => p.name === process);
      const processParams =
        info?.params && Object.keys(info.params).length > 0
          ? ({ ...info.params } as Record<string, JsonValue>)
          : {};
      patchControl(frame.id, { process, processParams });
      setProcessed(frame.id, null);
    },
    [frame, patchControl, setProcessed, preprocessors],
  );

  const handleParamChange = useCallback(
    (key: string, value: JsonValue) => {
      if (!frame) return;
      patchControl(frame.id, { processParams: { ...frame.control.processParams, [key]: value } });
    },
    [frame, patchControl],
  );

  const modesForModel = useMemo(() => {
    if (!controlModes || !control || control.model === "None") return null;
    if (controlModes[control.model]) return controlModes[control.model];
    for (const [key, modes] of Object.entries(controlModes)) {
      if (control.model.toLowerCase().includes(key.toLowerCase())) return modes;
    }
    return null;
  }, [controlModes, control]);

  // Composed frames other than this one, for the picture source
  const linkOptions = useMemo(() => {
    if (!frame) return [];
    return outline.entries
      .filter((e) => e.frameId !== frame.id && (e.role === "initial" || e.role === "control"))
      .map((e) => ({ value: e.frameId, label: `uses ${positionLabel(e.position)}` }));
  }, [outline, frame]);

  if (!frame || !control) return null;
  const isIpAdapter = frame.role === "ipAdapter";
  const showProcessor = !isIpAdapter && type !== "style_transfer";
  const showModel = showProcessor;
  const showTiming = isIpAdapter || type === "controlnet" || type === "xs";
  const showGuess = !isIpAdapter && type === "controlnet";
  const showFactor = !isIpAdapter && type === "t2i";
  const showStyleTransfer = !isIpAdapter && type === "style_transfer";
  const canProcess = showProcessor && source?.file != null && control.process !== "None";
  const gap = compact ? "gap-1.5" : "gap-2";
  const set = (patch: Parameters<typeof patchControl>[1]) => patchControl(frame.id, patch);
  const setIp = (patch: Parameters<typeof patchIpAdapter>[1]) => patchIpAdapter(frame.id, patch);

  const processButton = canProcess && (
    <Button
      variant="outline"
      size="sm"
      className="h-6 text-2xs px-2 gap-1 ml-auto"
      onClick={() => void handleProcess()}
      disabled={preprocessMutation.isPending}
    >
      {preprocessMutation.isPending ? (
        <Loader2 size={10} className="animate-spin" />
      ) : (
        <Play size={10} />
      )}
      Process
    </Button>
  );

  return (
    <div className={`flex flex-col ${gap}`}>
      {!isIpAdapter && (
        <Row label="Type">
          <Combobox
            value={type}
            onValueChange={(v) => set({ type: v as ControlType })}
            options={CONTROL_TYPES.map((t) => ({ value: t, label: controlTypeLabel(t) }))}
            className="h-6 text-2xs flex-1"
          />
        </Row>
      )}

      {!isIpAdapter && (
        <Row label="Picture">
          <Combobox
            value={frame.link?.frameId ?? "own"}
            onValueChange={(v) => setLink(frame.id, v === "own" ? null : v)}
            options={[{ value: "own", label: "Own picture" }, ...linkOptions]}
            className="h-6 text-2xs flex-1"
          />
        </Row>
      )}

      {!isIpAdapter && !frame.link && (
        <Row label="Fit">
          <Combobox
            value={frame.fit ?? "free"}
            onValueChange={(v) => setFit(frame.id, v === "free" ? null : (v as FitPolicy))}
            options={FITS}
            className="h-6 text-2xs flex-1"
          />
        </Row>
      )}

      {showProcessor && (
        <Row label="Processor">
          <Combobox
            value={control.process}
            onValueChange={handleProcessorChange}
            groups={[{ heading: "", options: ["None"] }, ...processorGroups]}
            className="h-6 text-2xs flex-1"
          />
        </Row>
      )}

      {showModel && (
        <Row label="Model">
          <Combobox
            value={control.model}
            onValueChange={(v) => set({ model: v })}
            options={["None", ...(models ?? [])]}
            className="h-6 text-2xs flex-1"
          />
        </Row>
      )}

      {showModel && modesForModel && modesForModel.length > 0 && (
        <Row label="Mode">
          <Combobox
            value={control.mode}
            onValueChange={(v) => set({ mode: v })}
            options={modesForModel}
            className="h-6 text-2xs flex-1"
          />
        </Row>
      )}

      {showModel && (
        <ParamSlider
          label="Strength"
          value={control.strength}
          onChange={(v) => set({ strength: v })}
          min={0.01}
          max={2}
          step={0.01}
        />
      )}

      {isIpAdapter && (
        <>
          <Row label="Adapter">
            <Combobox
              value={frame.ipAdapter.adapter}
              onValueChange={(v) => setIp({ adapter: v })}
              options={["None", ...(adapterModels ?? [])]}
              className="h-6 text-2xs flex-1"
            />
          </Row>
          <ParamSlider
            label="Scale"
            value={frame.ipAdapter.scale}
            onChange={(v) => setIp({ scale: v })}
            min={0}
            max={2}
            step={0.01}
          />
          <Row label="Crop">
            <Switch checked={frame.ipAdapter.crop} onCheckedChange={(crop) => setIp({ crop })} />
          </Row>
        </>
      )}

      {showTiming && (
        <SectionLeader title="Timing" collapsible defaultCollapsed>
          <ParamGrid>
            <ParamSlider
              label="Start"
              value={isIpAdapter ? frame.ipAdapter.start : control.start}
              onChange={(v) => (isIpAdapter ? setIp({ start: v }) : set({ start: v }))}
              min={0}
              max={1}
              step={0.01}
            />
            <ParamSlider
              label="End"
              value={isIpAdapter ? frame.ipAdapter.end : control.end}
              onChange={(v) => (isIpAdapter ? setIp({ end: v }) : set({ end: v }))}
              min={0}
              max={1}
              step={0.01}
            />
          </ParamGrid>
        </SectionLeader>
      )}

      {showProcessor && processorDefaults && (
        <SectionLeader title="Processor Settings" collapsible defaultCollapsed>
          {Object.entries(control.processParams).map(([key, value]) => {
            const def = processorDefaults[key];
            if (typeof value === "boolean" || typeof def === "boolean") {
              return (
                <label
                  key={key}
                  className="flex items-center gap-1.5 text-2xs text-muted-foreground cursor-pointer"
                >
                  <Checkbox
                    checked={!!value}
                    onCheckedChange={(c) => handleParamChange(key, !!c)}
                  />
                  {key}
                </label>
              );
            }
            if (typeof value === "number" || typeof def === "number") {
              const numDef = typeof def === "number" ? def : typeof value === "number" ? value : 0;
              const inferred = inferSliderRange(numDef);
              return (
                <ParamSlider
                  key={key}
                  label={key}
                  value={typeof value === "number" ? value : numDef}
                  onChange={(v) => handleParamChange(key, v)}
                  min={inferred.min}
                  max={inferred.max}
                  step={inferred.step}
                />
              );
            }
            if (typeof value === "string" || typeof def === "string") {
              const options = STRING_PARAM_OPTIONS[key];
              const text = typeof value === "string" ? value : typeof def === "string" ? def : "";
              return (
                <div key={key} className="flex items-center gap-1.5">
                  <span className="text-2xs text-muted-foreground shrink-0">{key}</span>
                  {options ? (
                    <Combobox
                      value={text}
                      onValueChange={(v) => handleParamChange(key, v)}
                      options={options}
                      className="h-6 text-2xs flex-1"
                    />
                  ) : (
                    <input
                      type="text"
                      value={text}
                      onChange={(e) => handleParamChange(key, e.target.value)}
                      className="h-6 text-2xs flex-1 rounded border bg-background px-1.5"
                    />
                  )}
                </div>
              );
            }
            return null;
          })}
        </SectionLeader>
      )}

      {!isIpAdapter && (
        <div className="flex items-center justify-between">
          {showGuess && (
            <label className="flex items-center gap-1.5 text-2xs text-muted-foreground cursor-pointer">
              <Checkbox checked={control.guess} onCheckedChange={(c) => set({ guess: !!c })} />
              Guess mode
            </label>
          )}
          {processButton}
        </div>
      )}

      {frame.processed && (
        <button
          type="button"
          onClick={() => setProcessed(frame.id, null)}
          className="text-3xs text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1"
        >
          <X size={10} />
          Clear processed
        </button>
      )}

      {showFactor && (
        <ParamSlider
          label="Factor"
          value={control.factor}
          onChange={(v) => set({ factor: v })}
          min={0.01}
          max={2}
          step={0.01}
        />
      )}

      {showStyleTransfer && (
        <>
          <Row label="Attention">
            <Combobox
              value={control.attention}
              onValueChange={(v) => set({ attention: v })}
              options={["Attention", "Adain", "Attention and Adain"]}
              className="h-6 text-2xs flex-1"
            />
          </Row>
          <ParamGrid>
            <ParamSlider
              label="Query Weight"
              value={control.queryWeight}
              onChange={(v) => set({ queryWeight: v })}
              min={0}
              max={2}
              step={0.01}
            />
            <ParamSlider
              label="Adain Weight"
              value={control.adainWeight}
              onChange={(v) => set({ adainWeight: v })}
              min={0}
              max={2}
              step={0.01}
            />
          </ParamGrid>
          <ParamSlider
            label="Fidelity"
            value={control.fidelity}
            onChange={(v) => set({ fidelity: v })}
            min={0}
            max={1}
            step={0.01}
          />
        </>
      )}

      {isIpAdapter && (
        <>
          <PictureList
            label="Images"
            pictures={frame.pictures}
            onRemove={(id) => removePicture(frame.id, id)}
            onAdd={(file) => void addFilesToInputs([file], frame.id)}
            addLabel="Add reference"
          />
          <PictureList
            label="Masks"
            pictures={frame.ipAdapter.masks}
            onRemove={(id) => removeIpMask(frame.id, id)}
            onAdd={(file) => void toNewPicture(file).then((p) => addIpMask(frame.id, p))}
            addLabel="Add mask"
          />
        </>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <ParamLabel className="text-2xs text-muted-foreground w-16 flex-shrink-0">{label}</ParamLabel>
      {children}
    </div>
  );
}

function Thumb({ picture, onRemove }: { picture: Picture; onRemove: () => void }) {
  const url = useBlobUrl(picture.file);
  return (
    <div className="relative h-16 w-16 rounded border border-border overflow-hidden group">
      {url && <img src={url} alt={picture.name} className="w-full h-full object-cover" />}
      <Button
        variant="destructive"
        size="icon-sm"
        className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 h-4 w-4"
        onClick={onRemove}
      >
        <X size={8} />
      </Button>
    </div>
  );
}

function PictureList({
  label,
  pictures,
  onRemove,
  onAdd,
  addLabel,
}: {
  label: string;
  pictures: Picture[];
  onRemove: (pictureId: string) => void;
  onAdd: (file: File) => void;
  addLabel: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-2xs text-muted-foreground">{label}</Label>
      <div className="flex gap-1 flex-wrap">
        {pictures.map((p) => (
          <Thumb key={p.id} picture={p} onRemove={() => onRemove(p.id)} />
        ))}
      </div>
      <ImageUpload
        image={null}
        onImageChange={(file) => {
          if (file) onAdd(file);
        }}
        label={addLabel}
        compact
      />
    </div>
  );
}
