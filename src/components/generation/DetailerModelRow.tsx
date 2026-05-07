import { useMemo } from "react";
import type { DetailerModelEntry, DetailerOverrides } from "@/api/types/v2";
import { SectionLeader } from "@/components/ui/section-leader";
import { Button } from "@/components/ui/button";
import { ParamGrid } from "./ParamRow";
import { InheritableSlider } from "./InheritableSlider";
import { InheritableCheckbox } from "./InheritableCheckbox";
import { InheritableTextInput } from "./InheritableTextInput";
import { X } from "lucide-react";

interface DetailerModelRowProps {
  entry: DetailerModelEntry;
  defaults: DetailerOverrides;
  onUpdate: (entry: DetailerModelEntry) => void;
  onRemove: () => void;
  disabled?: boolean;
  level?: 0 | 1 | 2;
}

/** Per-model accordion row for the V2 detailer.
 *
 * Wraps a SectionLeader with the model name as title and × remove button.
 * Body grids inheritable controls keyed by override field. Each setter calls
 * onUpdate with a new entry where the field is set or omitted (to inherit).
 */
export function DetailerModelRow({
  entry,
  defaults,
  onUpdate,
  onRemove,
  disabled,
  level = 1,
}: DetailerModelRowProps) {
  // Build typed setter pairs: (key) => { onOverride, onClear }.
  // Ensures the per-key handlers reference the latest entry without
  // forcing the parent to memoize a giant map of callbacks.
  const set = useMemo(() => {
    function setField<K extends keyof DetailerOverrides>(
      key: K,
      value: DetailerOverrides[K] | undefined,
    ) {
      const next: DetailerModelEntry = { ...entry };
      if (value === undefined) delete next[key];
      else (next[key] as DetailerOverrides[K]) = value;
      onUpdate(next);
    }
    return {
      override:
        <K extends keyof DetailerOverrides>(key: K) =>
        (v: DetailerOverrides[K]) =>
          setField(key, v),
      clear:
        <K extends keyof DetailerOverrides>(key: K) =>
        () =>
          setField(key, undefined),
    };
  }, [entry, onUpdate]);

  const removeAction = (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      title="Remove this detector"
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
    >
      <X size={11} />
    </Button>
  );

  return (
    <SectionLeader
      title={entry.name}
      collapsible
      defaultCollapsed
      level={level}
      action={removeAction}
      parentDisabled={disabled}
    >
      <div className="flex flex-col gap-2">
        <ParamGrid>
          <InheritableSlider
            label="Strength"
            tooltip="Denoise strength applied to each detected region. Lower = lighter touch, preserves more of the original."
            inheritedValue={defaults.strength ?? 0.3}
            overrideValue={entry.strength}
            onOverride={set.override("strength")}
            onClear={set.clear("strength")}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
          />
          <InheritableSlider
            label="Steps"
            tooltip="Number of diffusion steps for the detailer pass on each detected region."
            inheritedValue={defaults.steps ?? 10}
            overrideValue={entry.steps}
            onOverride={set.override("steps")}
            onClear={set.clear("steps")}
            min={0}
            max={99}
            step={1}
          />
          <InheritableSlider
            label="Resolution"
            tooltip="Working resolution for the detailer pass per region. Larger = more detail, slower."
            inheritedValue={defaults.resolution ?? 1024}
            overrideValue={entry.resolution}
            onOverride={set.override("resolution")}
            onClear={set.clear("resolution")}
            min={256}
            max={4096}
            step={8}
          />
          <InheritableSlider
            label="Padding"
            tooltip="Pixels of padding around each detected region before inpainting."
            inheritedValue={defaults.padding ?? 20}
            overrideValue={entry.padding}
            onOverride={set.override("padding")}
            onClear={set.clear("padding")}
            min={0}
            max={256}
            step={1}
          />
          <InheritableSlider
            label="Blur"
            tooltip="Mask edge blur. Softens the seam between inpainted region and surrounding image."
            inheritedValue={defaults.blur ?? 10}
            overrideValue={entry.blur}
            onOverride={set.override("blur")}
            onClear={set.clear("blur")}
            min={0}
            max={64}
            step={1}
          />
          <InheritableSlider
            label="Confidence"
            tooltip="Minimum detection confidence (0-1) for a region to be processed."
            inheritedValue={defaults.conf ?? 0.6}
            overrideValue={entry.conf}
            onOverride={set.override("conf")}
            onClear={set.clear("conf")}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
          />
          <InheritableSlider
            label="IoU"
            tooltip="Intersection-over-union threshold for non-max suppression of overlapping detections."
            inheritedValue={defaults.iou ?? 0.5}
            overrideValue={entry.iou}
            onOverride={set.override("iou")}
            onClear={set.clear("iou")}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
          />
          <InheritableSlider
            label="Min size"
            tooltip="Minimum region size (fraction of image area) to detect."
            inheritedValue={defaults.min_size ?? 0.0}
            overrideValue={entry.min_size}
            onOverride={set.override("min_size")}
            onClear={set.clear("min_size")}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
          />
          <InheritableSlider
            label="Max size"
            tooltip="Maximum region size (fraction of image area) to detect."
            inheritedValue={defaults.max_size ?? 1.0}
            overrideValue={entry.max_size}
            onOverride={set.override("max_size")}
            onClear={set.clear("max_size")}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
          />
          <InheritableSlider
            label="Max detect"
            tooltip="Maximum number of detected regions to process per pass."
            inheritedValue={defaults.max ?? 2}
            overrideValue={entry.max}
            onOverride={set.override("max")}
            onClear={set.clear("max")}
            min={1}
            max={20}
            step={1}
          />
          <InheritableSlider
            label="Renoise"
            tooltip="Sigma adjust at start. Multiplier on noise schedule for the detailer pass."
            inheritedValue={defaults.sigma_adjust ?? 1.0}
            overrideValue={entry.sigma_adjust}
            onOverride={set.override("sigma_adjust")}
            onClear={set.clear("sigma_adjust")}
            min={0}
            max={2}
            step={0.01}
            decimals={2}
          />
          <InheritableSlider
            label="Renoise end"
            tooltip="Sigma adjust at end. Multiplier on noise schedule terminus for the detailer pass."
            inheritedValue={defaults.sigma_adjust_max ?? 1.0}
            overrideValue={entry.sigma_adjust_max}
            onOverride={set.override("sigma_adjust_max")}
            onClear={set.clear("sigma_adjust_max")}
            min={0}
            max={2}
            step={0.01}
            decimals={2}
          />
        </ParamGrid>

        <div className="grid grid-cols-2 gap-2">
          <InheritableCheckbox
            label="Segmentation"
            tooltip="Use segmentation masks (if model supports them) instead of bounding boxes."
            inheritedValue={defaults.segmentation ?? false}
            overrideValue={entry.segmentation}
            onOverride={set.override("segmentation")}
            onClear={set.clear("segmentation")}
          />
          <InheritableCheckbox
            label="Include detections"
            tooltip="Append the annotated detection-overlay image to the output set."
            inheritedValue={defaults.include_detections ?? false}
            overrideValue={entry.include_detections}
            onOverride={set.override("include_detections")}
            onClear={set.clear("include_detections")}
          />
          <InheritableCheckbox
            label="Merge"
            tooltip="Merge multiple detections from this model before inpainting."
            inheritedValue={defaults.merge ?? false}
            overrideValue={entry.merge}
            onOverride={set.override("merge")}
            onClear={set.clear("merge")}
          />
          <InheritableCheckbox
            label="Sort"
            tooltip="Sort detections by score before applying max-detect cap."
            inheritedValue={defaults.sort ?? false}
            overrideValue={entry.sort}
            onOverride={set.override("sort")}
            onClear={set.clear("sort")}
          />
          <InheritableCheckbox
            label="Augment"
            tooltip="Apply test-time augmentation during detection (slower, may catch more)."
            inheritedValue={defaults.augment ?? false}
            overrideValue={entry.augment}
            onOverride={set.override("augment")}
            onClear={set.clear("augment")}
          />
        </div>

        <InheritableTextInput
          label="Classes"
          tooltip="Comma-separated class filter (e.g. 'person, face'). Empty = all classes."
          inheritedValue={defaults.classes ?? ""}
          overrideValue={entry.classes}
          onOverride={set.override("classes")}
          onClear={set.clear("classes")}
          placeholder="e.g. person, face"
        />

        <InheritableTextInput
          label="Prompt"
          tooltip="Per-detector prompt override. Use [PROMPT] to inject the main prompt; leave empty to inherit."
          inheritedValue={defaults.prompt ?? ""}
          overrideValue={entry.prompt}
          onOverride={set.override("prompt")}
          onClear={set.clear("prompt")}
          placeholder="Inherits main detailer prompt if empty"
        />

        <InheritableTextInput
          label="Negative"
          tooltip="Per-detector negative prompt override. Use [PROMPT] to inject the main negative; leave empty to inherit."
          inheritedValue={defaults.negative ?? ""}
          overrideValue={entry.negative}
          onOverride={set.override("negative")}
          onClear={set.clear("negative")}
          placeholder="Inherits main detailer negative if empty"
        />
      </div>
    </SectionLeader>
  );
}
