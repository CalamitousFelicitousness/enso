import { useMemo, useCallback } from "react";
import { useGenerationStore } from "@/stores/generationStore";
import { useUiStore } from "@/stores/uiStore";
import { useImg2ImgStore } from "@/stores/img2imgStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { useIsImg2Img } from "@/hooks/useIsImg2Img";
import { useAspectLock, useAspectPresets } from "@/hooks/useAspectLock";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { useShallow } from "zustand/react/shallow";
import { usePromptStyles } from "@/api/hooks/useNetworks";
import { useUpscalerGroups } from "@/api/hooks/useModels";
import { cn } from "@/lib/utils";
import { resolveGenerationSize, formatMegapixels } from "@/lib/sizeCompute";
import type { SizeMode } from "@/lib/sizeCompute";
import type { AspectPreset } from "@/lib/aspect";
import type { ParamDescriptor } from "@/api/types/cloud";
import type { GenerationInfo } from "@/api/types/generation";
import { PromptEditor } from "../PromptEditor";
import { StylePicker } from "../StylePicker";
import { ParamSlider } from "../ParamSlider";
import { AspectRatioControl } from "../AspectRatioControl";
import { SectionLeader, SectionDivider } from "@/components/ui/section-leader";
import { ParamGrid } from "../ParamRow";
import { ParamLabel } from "../ParamLabel";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { SegmentedControl } from "@/components/ui/segmented-control";

const IMAGE_AXIS = { min: 64, max: 4096, multiple: 8 };

const GENERIC_CLOUD_PRESETS: AspectPreset[] = [
  { label: "1024x1024", w: 1024, h: 1024 },
  { label: "1536x1024", w: 1536, h: 1024 },
  { label: "1024x1536", w: 1024, h: 1536 },
  { label: "1024x768", w: 1024, h: 768 },
  { label: "768x1024", w: 768, h: 1024 },
  { label: "1280x720", w: 1280, h: 720 },
];

function parseSizeOptions(params: ParamDescriptor[] | null): AspectPreset[] | null {
  if (!params) return null;
  const sizeParam = params.find((p) => p.name === "size" && p.type === "enum" && p.options);
  if (!sizeParam?.options) return null;
  const presets: AspectPreset[] = [];
  for (const opt of sizeParam.options) {
    if (opt === "auto") continue;
    const [w, h] = opt.split("x").map(Number);
    if (w > 0 && h > 0) presets.push({ label: opt, w, h });
  }
  return presets.length > 0 ? presets : null;
}

export function PromptsTab() {
  const state = useGenerationStore(
    useShallow((s) => ({
      width: s.width,
      height: s.height,
      batchCount: s.batchCount,
      batchSize: s.batchSize,
      styles: s.styles,
    })),
  );
  const setParam = useGenerationStore((s) => s.setParam);
  const { data: styles } = usePromptStyles();
  const isImg2Img = useIsImg2Img();
  const autoFitFrame = useUiStore((s) => s.autoFitFrame);
  const setAutoFitFrame = useUiStore((s) => s.setAutoFitFrame);
  const sizeMode = useImg2ImgStore((s) => s.sizeMode);
  const setSizeMode = useImg2ImgStore((s) => s.setSizeMode);
  const scaleFactor = useImg2ImgStore((s) => s.scaleFactor);
  const setScaleFactor = useImg2ImgStore((s) => s.setScaleFactor);
  const megapixelTarget = useImg2ImgStore((s) => s.megapixelTarget);
  const setMegapixelTarget = useImg2ImgStore((s) => s.setMegapixelTarget);
  const resizeMethod = useImg2ImgStore((s) => s.resizeMethod);
  const setResizeMethod = useImg2ImgStore((s) => s.setResizeMethod);
  const autoSize = useImg2ImgStore((s) => s.autoSize);
  const setAutoSize = useImg2ImgStore((s) => s.setAutoSize);
  const upscalerGroups = useUpscalerGroups({ excludeLatent: true });
  const activeModel = useModelSelectionStore((s) => s.activeModel);
  const cloudSizePresets = useMemo(() => {
    // Narrow inside the closure so `.supported_params` and `.size_constraint`
    // access is type-safe and doesn't leak into non-cloud model branches
    // (local-video has no such fields).
    if (!activeModel || activeModel.source !== "cloud") return null;

    //.5: size_constraint is authoritative when present.
    const sc = activeModel.size_constraint;
    if (sc?.kind === "enum" && sc.options.length > 0) {
      const presets: AspectPreset[] = [];
      for (const opt of sc.options) {
        const [w, h] = opt.split("x").map(Number);
        if (w > 0 && h > 0) presets.push({ label: opt, w, h });
      }
      return presets.length > 0 ? presets : null;
    }
    if (sc?.kind === "bucket" && sc.options.length > 0) {
      // Bucket: labels are symbolic; resolve provides display hints.
      // TODO: send the symbolic label on the wire instead of the resolved WxH
      //. Requires plumbing an activeBucketSymbol state
      // through to buildCloudImageRequest. No priority models use bucket today
      // (NanoGPT catalogue codifies as enum), so deferred.
      const presets: AspectPreset[] = [];
      for (const opt of sc.options) {
        const resolved = sc.resolve[opt];
        if (resolved) presets.push({ label: opt, w: resolved.w, h: resolved.h });
      }
      return presets.length > 0 ? presets : null;
    }
    if (sc?.kind === "free") {
      // Free: no preset list. Width/Height inputs only.
      // TODO: surface min/max/align validation indicators when a model uses this shape.
      return null;
    }

    // Pre-Phase-2.5 fallback: supported_params enum, then GENERIC list.
    return parseSizeOptions(activeModel.supported_params ?? null) ?? GENERIC_CLOUD_PRESETS;
  }, [activeModel]);

  // Auto button is always clickable on cloud models. The provider is the
  // source of truth about what `size` values it accepts; if our codified
  // allow_auto is wrong (stale catalog, undocumented support), the user
  // should still be able to try it and let the server respond. sdnext's
  // soft pre-flight logs the mismatch via telemetry; the
  // provider's 400 surfaces via the job-error path. autoAllowedHint is
  // tooltip-only: when explicitly false, the tooltip warns that the
  // model's catalog doesn't advertise auto support.
  const autoAllowedHint = useMemo(() => {
    if (!activeModel || activeModel.source !== "cloud") return true;
    const sc = activeModel.size_constraint;
    if (sc == null) return true;
    return sc.allow_auto;
  }, [activeModel]);

  // Echoed-size surfacing: when the server returns dims
  // that differ from what was requested (auto resolution, align-snap, bucket
  // resolve, local hires-fix output), show them so the user isn't confused
  // about why their image is a different size than the controls say.
  const lastResult = useGenerationStore((s) => s.results[0]);
  const lastInfo = useMemo<GenerationInfo | null>(() => {
    if (!lastResult?.info) return null;
    try {
      return JSON.parse(lastResult.info) as GenerationInfo;
    } catch {
      return null;
    }
  }, [lastResult]);
  const lastResultSize = useMemo(() => {
    if (!lastInfo) return null;
    const w = lastInfo.width;
    const h = lastInfo.height;
    if (typeof w !== "number" || typeof h !== "number") return null;
    if (w <= 0 || h <= 0) return null;
    if (w === state.width && h === state.height) return null;
    return { w, h };
  }, [lastInfo, state.width, state.height]);

  // Reference mode on local models sends the source file raw via `inputs`. The
  // server's resize_init_images then overrides p.width/p.height to match the
  // image, so Size is informational here. Cloud models honor request.size
  // independently of the image, so they're never advisory. With multi-Input
  // frames the advisory only fires when every populated frame is Reference -
  // a single Initial frame is enough to honor the user-set Size.
  const firstReferenceImage = useCanvasStore((s) => {
    for (const f of s.inputFrames) {
      if (f.mode === "reference" && f.references.length > 0) {
        return f.references[0];
      }
    }
    return null;
  });
  const hasAnyInitialImage = useCanvasStore((s) =>
    s.inputFrames.some(
      (f) => f.mode === "initial" && f.layers.some((l) => l.type === "image" && l.visible),
    ),
  );
  const isCloud = activeModel != null && activeModel.source === "cloud";
  const referenceInactive =
    firstReferenceImage != null && !hasAnyInitialImage && activeModel != null && !isCloud;
  // Auto dims Size whenever the user toggle is on (cloud). The provider may
  // still reject the auto value at submission time; that's caught via the
  // job-error path, not by client-side UI suppression.
  const autoInactive = isCloud && autoSize;
  const sizeIsAdvisory = referenceInactive || autoInactive;
  const sizeTooltip = useMemo(() => {
    const base = "Output dimensions in pixels.";
    const notes: string[] = [];
    if (autoInactive) {
      notes.push(
        "Auto modifier is on &mdash; the server picks output dimensions. " +
          "Turn Auto off to control output size.",
      );
    }
    if (referenceInactive && firstReferenceImage) {
      notes.push(
        "Inactive in Reference mode on local models &mdash; " +
          `output resolution is set by the input image ` +
          `(${firstReferenceImage.naturalWidth}&times;${firstReferenceImage.naturalHeight}). ` +
          "Switch to Initial to control output size.",
      );
    }
    if (notes.length === 0) return base;
    return (
      `${base}<br><br>` + notes.map((n) => `<span style="opacity:0.7">${n}</span>`).join("<br><br>")
    );
  }, [autoInactive, referenceInactive, firstReferenceImage]);
  const aspectPresets = useAspectPresets();

  const showSizeModes = isImg2Img && autoFitFrame;
  const effectiveSizeMode: SizeMode = showSizeModes ? sizeMode : "fixed";
  const isFixed = effectiveSizeMode === "fixed";

  const genSize = useMemo(
    () =>
      resolveGenerationSize(
        effectiveSizeMode,
        state.width,
        state.height,
        scaleFactor,
        megapixelTarget,
      ),
    [effectiveSizeMode, state.width, state.height, scaleFactor, megapixelTarget],
  );

  const onWidth = useCallback((v: number) => setParam("width", v), [setParam]);
  const onHeight = useCallback((v: number) => setParam("height", v), [setParam]);
  const aspect = useAspectLock({
    width: state.width,
    height: state.height,
    onWidth,
    onHeight,
    widthRule: IMAGE_AXIS,
    heightRule: IMAGE_AXIS,
  });

  const set = useMemo(
    () => ({
      batchCount: (v: number) => setParam("batchCount", v),
      batchSize: (v: number) => setParam("batchSize", v),
    }),
    [setParam],
  );

  return (
    <div className="flex flex-col gap-3 text-sm">
      <PromptEditor />

      {Array.isArray(styles) && styles.length > 0 && (
        <>
          <SectionLeader title="Styles" collapsible defaultCollapsed>
            <StylePicker selected={state.styles} onChange={(v) => setParam("styles", v)} />
          </SectionLeader>
          <SectionDivider />
        </>
      )}

      <SectionLeader
        title="Size"
        collapsible
        tooltip={sizeTooltip}
        action={
          isImg2Img || isCloud ? (
            <div className="flex items-center gap-1">
              {isImg2Img && (
                <Button
                  variant={autoFitFrame ? "default" : "outline"}
                  size="sm"
                  onClick={() => setAutoFitFrame(!autoFitFrame)}
                  className="h-5 px-1.5 text-3xs rounded"
                  title={
                    autoFitFrame
                      ? "Fit on: dropping the first image onto an empty canvas resizes the frame to match that image's dimensions"
                      : "Fit off: frame stays at the width and height you set, regardless of image size"
                  }
                >
                  Fit
                </Button>
              )}
              {isCloud && (
                <Button
                  variant={autoSize ? "default" : "outline"}
                  size="sm"
                  onClick={() => setAutoSize(!autoSize)}
                  className="h-5 px-1.5 text-3xs rounded"
                  title={
                    (autoSize
                      ? "Auto on: server picks output dimensions. Size controls are inactive."
                      : "Auto off: you control output dimensions via Width and Height below.") +
                    (autoAllowedHint
                      ? ""
                      : " This model's catalog does not advertise Auto support; the request may be rejected.")
                  }
                >
                  Auto
                </Button>
              )}
            </div>
          ) : undefined
        }
      >
        <div
          className={cn("flex flex-col gap-2 transition-opacity", sizeIsAdvisory && "opacity-60")}
          title={sizeIsAdvisory ? sizeTooltip.replace(/<[^>]*>/g, "") : undefined}
        >
          {/* Size mode pill selector (img2img + auto-fit only) */}
          {showSizeModes && (
            <SegmentedControl
              options={[
                { value: "fixed", label: "Fixed" },
                { value: "scale", label: "Scale" },
                { value: "megapixel", label: "Megapixel" },
              ]}
              value={sizeMode}
              onValueChange={(v) => setSizeMode(v)}
              animated
            />
          )}

          {/* Width / Height sliders with the aspect lock binding the pair */}
          <div className="flex items-center gap-1.5">
            <div className="flex-1 min-w-0">
              <ParamSlider
                label="Width"
                tooltip="Output width in pixels, in steps of 8. Generation time and VRAM scale with width x height; sizes far above the model's native resolution invite doubled subjects and stretched composition."
                keywords={["size", "dimensions", "resolution", "aspect", "landscape"]}
                value={isFixed ? state.width : genSize.width}
                onChange={aspect.setWidth}
                min={aspect.widthBounds.min}
                max={aspect.widthBounds.max}
                step={8}
                disabled={!isFixed}
              />
            </div>
            <div data-param="aspect ratio" className="shrink-0">
              <AspectRatioControl
                presets={aspectPresets}
                activePreset={aspect.activePreset}
                onSelectPreset={aspect.selectPreset}
                onSwap={aspect.swap}
                disabled={!isFixed}
                isPresetDisabled={(p) => !aspect.fitsPreset(p)}
                absolutePresets={cloudSizePresets}
                onSelectAbsolute={aspect.selectAbsolute}
                currentSize={{ w: state.width, h: state.height }}
              />
            </div>
            <div className="flex-1 min-w-0">
              <ParamSlider
                label="Height"
                tooltip="Output height in pixels, in steps of 8. Generation time and VRAM scale with width x height; sizes far above the model's native resolution invite doubled subjects and stretched composition."
                keywords={["size", "dimensions", "resolution", "aspect", "portrait"]}
                value={isFixed ? state.height : genSize.height}
                onChange={aspect.setHeight}
                min={aspect.heightBounds.min}
                max={aspect.heightBounds.max}
                step={8}
                disabled={!isFixed}
              />
            </div>
          </div>

          {/* Scale slider */}
          {effectiveSizeMode === "scale" && (
            <ParamSlider
              label="Scale"
              tooltip="Multiplier applied to the input image size to compute the generation resolution."
              keywords={["resize", "factor", "multiplier", "img2img"]}
              value={scaleFactor}
              onChange={setScaleFactor}
              min={0.25}
              max={2}
              step={0.05}
            />
          )}

          {/* Megapixel slider */}
          {effectiveSizeMode === "megapixel" && (
            <ParamSlider
              label="Target"
              tooltip="Target output size in megapixels. Aspect ratio is preserved from the input image."
              keywords={["megapixel", "size", "resolution", "img2img"]}
              value={megapixelTarget}
              onChange={setMegapixelTarget}
              min={0.25}
              max={4}
              step={0.05}
            />
          )}

          {/* Resize method (shown when scale/megapixel active) */}
          {!isFixed && (
            <div className="flex items-center gap-2">
              <ParamLabel className="text-2xs text-muted-foreground w-16 flex-shrink-0">
                Resize
              </ParamLabel>
              <Combobox
                value={resizeMethod}
                onValueChange={setResizeMethod}
                groups={upscalerGroups}
                className="h-6 text-2xs flex-1"
              />
            </div>
          )}

          {/* Info line: frame size → generation size */}
          {!isFixed && (
            <div className="text-3xs text-muted-foreground text-center">
              {state.width}&times;{state.height} &rarr; {genSize.width}&times;
              {genSize.height}{" "}
              <span className="opacity-70">
                ({formatMegapixels(genSize.width, genSize.height)})
              </span>
            </div>
          )}

          {/* Echoed size: surfaced when server returned dims that differ from
              the current Width/Height. Covers auto resolution, align-snap,
              bucket resolve, and local hires-fix output. */}
          {lastResultSize && (
            <div
              className="text-3xs text-muted-foreground text-center flex items-center justify-center gap-1.5"
              title="The last generation finished at these dimensions. Differs from the controls above when the server picks the size (Auto), snaps to alignment, resolves a symbolic bucket, or applies hires-fix."
            >
              <span>
                Last:{" "}
                <span className="font-mono">
                  {lastResultSize.w}&times;{lastResultSize.h}
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  aspect.setWidth(lastResultSize.w);
                  aspect.setHeight(lastResultSize.h);
                }}
                className="px-1.5 py-0 text-3xs rounded border border-border/40 hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                Reuse
              </button>
            </div>
          )}
        </div>
      </SectionLeader>

      <SectionDivider />

      <SectionLeader title="Batch" collapsible>
        <ParamGrid>
          <ParamSlider
            label="Count"
            tooltip="How many batches of images to create (has no impact on generation performance or VRAM usage)"
            keywords={["batch count", "repeat", "iterations"]}
            value={state.batchCount}
            onChange={set.batchCount}
            min={1}
            max={100}
          />

          <ParamSlider
            label="Size"
            tooltip="How many image to create in a single batch (increases generation performance at cost of higher VRAM usage)"
            keywords={["batch size", "parallel", "simultaneous"]}
            value={state.batchSize}
            onChange={set.batchSize}
            min={1}
            max={16}
          />
        </ParamGrid>
      </SectionLeader>
    </div>
  );
}
