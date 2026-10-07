// What a frame's pictures are processed to before the model sees them: the
// processor, its parameters, where the map stands, and what to do about it.
// The control keeps one width whatever is picked, and the state line one
// height whatever it says.

import { useCallback, useMemo, useState } from "react";
import { Loader2, Play, Replace } from "lucide-react";
import { usePreprocessors } from "@/api/hooks/useControl";
import { buildProcessorGroups } from "@/lib/processorUtils";
import { SectionLeader } from "@/components/ui/section-leader";
import { Combobox } from "@/components/ui/combobox";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { useInputStore } from "@/stores/inputStore";
import { processNow } from "@/inputs/processing";
import { replaceWithMaps } from "@/inputs/edits";
import { useOutlineEnv } from "@/inputs/useOutline";
import type { OutlineEntry } from "@/lib/inputs/outline";
import { mapFailedText, mapsWord, noMapText, PROCESS_TO_NONE } from "@/lib/inputs/text";
import { composedPictures, isComposed, type Frame, type JsonValue } from "@/lib/inputs/types";
import { Row } from "../Row";
import { inferSliderRange, STRING_PARAM_OPTIONS } from "../processorParams";

const NONE_GROUP = { heading: "", options: [{ value: "None", label: PROCESS_TO_NONE }] };

interface ProcessToSectionProps {
  frame: Frame;
  entry: OutlineEntry;
}

export function ProcessToSection({ frame, entry }: ProcessToSectionProps) {
  const setProcessor = useInputStore((s) => s.setProcessor);
  const { data: preprocessors } = usePreprocessors();
  const env = useOutlineEnv();
  // a job is being started or a map drawn: the buttons wait for it
  const [starting, setStarting] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const processor = frame.processor;

  const groups = useMemo(
    () => (preprocessors ? buildProcessorGroups(preprocessors) : []),
    [preprocessors],
  );
  const defaults = useMemo(() => {
    const info = processor && preprocessors?.find((p) => p.name === processor.id);
    return info && Object.keys(info.params).length > 0 ? info.params : null;
  }, [preprocessors, processor]);

  const handleChange = useCallback(
    (id: string) => setProcessor(frame.id, id === "None" ? null : { id, params: {} }),
    [frame.id, setProcessor],
  );
  const setParam = (key: string, value: JsonValue) => {
    if (processor)
      setProcessor(frame.id, { ...processor, params: { ...processor.params, [key]: value } });
  };

  const maps = entry.maps;
  const word = mapsWord(maps);
  const failed = maps.find((m) => m.state === "failed");
  const busy = starting || maps.some((m) => m.state === "queued" || m.state === "processing");
  const needed = maps.some((m) => m.state === "needed" || m.state === "failed");
  const allCurrent = maps.length > 0 && maps.every((m) => m.state === "current");
  const layerCount = isComposed(frame.role) ? composedPictures(frame).length : 0;
  const replaceLabel =
    layerCount > 1
      ? `Replace ${layerCount} layers with the map`
      : isComposed(frame.role)
        ? "Replace with map"
        : "Replace with maps";

  return (
    <SectionLeader title="Process to" collapsible>
      <Row label="Process to">
        <Combobox
          value={processor?.id ?? "None"}
          onValueChange={handleChange}
          groups={[NONE_GROUP, ...groups]}
          className="h-6 text-2xs flex-1"
        />
      </Row>

      {processor && defaults && (
        <SectionLeader title="Processor settings" collapsible defaultCollapsed level={1}>
          {Object.entries(defaults).map(([key, def]) => {
            const value = processor.params[key] ?? (def as JsonValue);
            if (typeof def === "boolean") {
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
            if (typeof def === "number") {
              const range = inferSliderRange(def);
              return (
                <ParamSlider
                  key={key}
                  label={key}
                  value={typeof value === "number" ? value : def}
                  onChange={(v) => setParam(key, v)}
                  min={range.min}
                  max={range.max}
                  step={range.step}
                />
              );
            }
            if (typeof def === "string") {
              const options = STRING_PARAM_OPTIONS[key];
              const text = typeof value === "string" ? value : def;
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

      {processor && (
        <>
          {/* Fixed height, so the buttons do not move with the words */}
          <p
            className={`h-4 truncate text-3xs ${failed ? "text-destructive" : "text-muted-foreground"}`}
            title={failed ? mapFailedText(failed.reason ?? "") : (word ?? undefined)}
          >
            {failed
              ? mapFailedText(failed.reason ?? "")
              : maps.length === 0
                ? noMapText(entry, env.processing != null)
                : word}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-2xs px-2 gap-1"
              onClick={() => {
                setStarting(true);
                void processNow(env, [frame.id]).finally(() => setStarting(false));
              }}
              disabled={!needed || busy}
              title="Make the map now, in a queued job, instead of when you generate"
            >
              {busy ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
              Process now
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-2xs px-2 gap-1"
              onClick={() => {
                setReplacing(true);
                void replaceWithMaps(env, frame.id).finally(() => setReplacing(false));
              }}
              disabled={!allCurrent || replacing}
              title="Keep the map as the picture itself and stop processing"
            >
              <Replace size={10} />
              {replaceLabel}
            </Button>
          </div>
        </>
      )}
    </SectionLeader>
  );
}
