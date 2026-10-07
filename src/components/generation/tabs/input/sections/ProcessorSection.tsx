// The sdnext processor applied to a Control frame's picture before the
// control model sees it, with a manual Process for a preview of the map.

import { useCallback, useMemo } from "react";
import { Loader2, Play, X } from "lucide-react";
import { toast } from "sonner";
import { usePreprocessImage, usePreprocessors } from "@/api/hooks/useControl";
import { uploadFile } from "@/lib/upload";
import { base64ToBlob } from "@/lib/utils";
import { buildProcessorGroups } from "@/lib/processorUtils";
import { SectionLeader } from "@/components/ui/section-leader";
import { Combobox } from "@/components/ui/combobox";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { useInputStore } from "@/stores/inputStore";
import { imageSize } from "@/inputs/media";
import {
  composedPictures,
  isComposed,
  type Frame,
  type JsonValue,
  type Picture,
} from "@/lib/inputs/types";
import { Row } from "../Row";
import { inferSliderRange, STRING_PARAM_OPTIONS } from "../processorParams";

/** The picture a Control frame's processor would run on: its own composite's
 * base, or its link's target's. Null without one or when its bytes are gone. */
function sourcePicture(frames: Frame[], frame: Frame): Picture | null {
  const source = frame.link ? frames.find((f) => f.id === frame.link?.frameId) : frame;
  if (!source || !isComposed(source.role)) return null;
  return composedPictures(source)[0] ?? null;
}

export function ProcessorSection({ frame }: { frame: Frame }) {
  const frames = useInputStore((s) => s.frames);
  const patchControl = useInputStore((s) => s.patchControl);
  const setProcessed = useInputStore((s) => s.setProcessed);
  const { data: preprocessors } = usePreprocessors();
  const preprocessMutation = usePreprocessImage();
  const control = frame.control;
  const source = sourcePicture(frames, frame);

  const groups = useMemo(
    () => (preprocessors ? buildProcessorGroups(preprocessors) : []),
    [preprocessors],
  );

  const defaults = useMemo(() => {
    if (!preprocessors || control.process === "None") return null;
    const info = preprocessors.find((p) => p.name === control.process);
    return info && Object.keys(info.params).length > 0 ? info.params : null;
  }, [preprocessors, control.process]);

  const handleProcessorChange = useCallback(
    (process: string) => {
      // the map was made by the processor before; the new one starts from the API's defaults
      const info = preprocessors?.find((p) => p.name === process);
      const processParams =
        info?.params && Object.keys(info.params).length > 0
          ? ({ ...info.params } as Record<string, JsonValue>)
          : {};
      patchControl(frame.id, { process, processParams });
      setProcessed(frame.id, null);
    },
    [frame.id, patchControl, setProcessed, preprocessors],
  );

  const setParam = (key: string, value: JsonValue) =>
    patchControl(frame.id, { processParams: { ...control.processParams, [key]: value } });

  const handleProcess = useCallback(async () => {
    if (!source?.file || control.process === "None") return;
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
  }, [frame.id, control, source, preprocessMutation, setProcessed]);

  const canProcess = source?.file != null && control.process !== "None";

  return (
    <SectionLeader title="Processor" collapsible>
      <Row label="Processor">
        <Combobox
          value={control.process}
          onValueChange={handleProcessorChange}
          groups={[{ heading: "", options: ["None"] }, ...groups]}
          className="h-6 text-2xs flex-1"
        />
      </Row>

      {defaults && (
        <SectionLeader title="Processor settings" collapsible defaultCollapsed level={1}>
          {Object.entries(control.processParams).map(([key, value]) => {
            const def = defaults[key];
            if (typeof value === "boolean" || typeof def === "boolean") {
              return (
                <label
                  key={key}
                  className="flex items-center gap-1.5 text-2xs text-muted-foreground cursor-pointer"
                >
                  <Checkbox checked={!!value} onCheckedChange={(c) => setParam(key, !!c)} />
                  {key}
                </label>
              );
            }
            if (typeof value === "number" || typeof def === "number") {
              const numDef = typeof def === "number" ? def : typeof value === "number" ? value : 0;
              const range = inferSliderRange(numDef);
              return (
                <ParamSlider
                  key={key}
                  label={key}
                  value={typeof value === "number" ? value : numDef}
                  onChange={(v) => setParam(key, v)}
                  min={range.min}
                  max={range.max}
                  step={range.step}
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
                      onValueChange={(v) => setParam(key, v)}
                      options={options}
                      className="h-6 text-2xs flex-1"
                    />
                  ) : (
                    <input
                      type="text"
                      value={text}
                      onChange={(e) => setParam(key, e.target.value)}
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

      <div className="flex items-center justify-between gap-2">
        {frame.processed ? (
          <button
            type="button"
            onClick={() => setProcessed(frame.id, null)}
            className="text-3xs text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1"
          >
            <X size={10} />
            Clear processed
          </button>
        ) : (
          <span className="text-3xs text-muted-foreground">
            {canProcess ? "No preview yet" : "Pick a processor and a picture to preview"}
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-2xs px-2 gap-1"
          onClick={() => void handleProcess()}
          disabled={!canProcess || preprocessMutation.isPending}
        >
          {preprocessMutation.isPending ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <Play size={10} />
          )}
          Process
        </Button>
      </div>
    </SectionLeader>
  );
}
