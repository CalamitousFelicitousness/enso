import { useCallback, useEffect, useMemo } from "react";
import { Play, Loader2 } from "lucide-react";
import { useProcessStore } from "@/stores/processStore";
import { useJobQueueStore, selectUpscaleActive, selectRembgActive } from "@/stores/jobStore";
import { useUpscalerList, useUpscalerGroups } from "@/api/hooks/useModels";
import { useSubmitToQueue } from "@/hooks/useSubmitToQueue";
import { uploadFile } from "@/lib/upload";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { Combobox } from "@/components/ui/combobox";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SectionLeader } from "@/components/ui/section-leader";

const REMBG_MODELS = [
  { value: "ben2", label: "BEN2" },
  { value: "u2net", label: "U2Net" },
  { value: "u2net_human_seg", label: "U2Net Human" },
  { value: "silueta", label: "Silueta" },
  { value: "isnet-general-use", label: "ISNet General" },
  { value: "isnet-anime", label: "ISNet Anime" },
];

export function ProcessPanel() {
  const image = useProcessStore((s) => s.image);
  const upscaler = useProcessStore((s) => s.upscaler);
  const scale = useProcessStore((s) => s.scale);
  const setUpscaler = useProcessStore((s) => s.setUpscaler);
  const setScale = useProcessStore((s) => s.setScale);
  const setUpscaleResult = useProcessStore((s) => s.setResult);

  const rembgModel = useProcessStore((s) => s.rembgModel);
  const returnMask = useProcessStore((s) => s.returnMask);
  const refine = useProcessStore((s) => s.refine);
  const setRembgModel = useProcessStore((s) => s.setRembgModel);
  const setReturnMask = useProcessStore((s) => s.setReturnMask);
  const setRefine = useProcessStore((s) => s.setRefine);

  const isUpscaling = useJobQueueStore(selectUpscaleActive);
  const isRembg = useJobQueueStore(selectRembgActive);

  const { data: upscalers } = useUpscalerList();
  const upscalerGroups = useUpscalerGroups();

  // Auto-select first non-"None" upscaler
  useEffect(() => {
    if (upscaler === "None" && upscalers && upscalers.length > 0) {
      const first = upscalers.find((u) => u.name !== "None");
      if (first) setUpscaler(first.name);
    }
  }, [upscalers, upscaler, setUpscaler]);

  // --- Upscale submission ---
  const buildUpscaleRequest = useCallback(async () => {
    if (!image) throw new Error("No image selected");
    setUpscaleResult(null);
    const ref = await uploadFile(image);
    return {
      payload: { type: "upscale" as const, image: ref, upscaler, scale },
      snapshot: {},
    };
  }, [image, upscaler, scale, setUpscaleResult]);

  const { submit: submitUpscale, isSubmitting: isSubmittingUpscale } = useSubmitToQueue(
    useMemo(
      () => ({ domain: "upscale" as const, buildRequest: buildUpscaleRequest }),
      [buildUpscaleRequest],
    ),
  );

  // --- Rembg submission ---
  const buildRembgRequest = useCallback(async () => {
    if (!image) throw new Error("No image selected");
    setUpscaleResult(null);
    const ref = await uploadFile(image);
    return {
      payload: {
        type: "rembg" as const,
        image: ref,
        model: rembgModel,
        return_mask: returnMask,
        refine: rembgModel === "ben2" ? refine : undefined,
      },
      snapshot: {},
    };
  }, [image, rembgModel, returnMask, refine, setUpscaleResult]);

  const { submit: submitRembg, isSubmitting: isSubmittingRembg } = useSubmitToQueue(
    useMemo(
      () => ({ domain: "rembg" as const, buildRequest: buildRembgRequest }),
      [buildRembgRequest],
    ),
  );

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 space-y-1">
        {/* Upscale section */}
        <SectionLeader title="Upscale" collapsible>
          <div className="space-y-3 pb-2">
            <div className="space-y-1.5">
              <Label className="text-2xs text-muted-foreground">Upscaler</Label>
              <Combobox
                value={upscaler}
                onValueChange={setUpscaler}
                groups={upscalerGroups}
                placeholder="Select upscaler..."
                className="h-6 text-2xs"
              />
            </div>
            <ParamSlider
              label="Scale"
              value={scale}
              onChange={setScale}
              min={1}
              max={8}
              step={0.5}
            />
            <Button
              type="button"
              onClick={submitUpscale}
              disabled={!image || isUpscaling || isSubmittingUpscale || upscaler === "None"}
              size="sm"
              className="w-full"
            >
              {isUpscaling ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Upscaling...
                </>
              ) : (
                <>
                  <Play size={14} />
                  Upscale
                </>
              )}
            </Button>
          </div>
        </SectionLeader>

        {/* Background Removal section */}
        <SectionLeader title="Background Removal" collapsible defaultCollapsed>
          <div className="space-y-3 pb-2">
            <div className="space-y-1.5">
              <Label className="text-2xs text-muted-foreground">Model</Label>
              <Combobox
                value={rembgModel}
                onValueChange={setRembgModel}
                options={REMBG_MODELS}
                placeholder="Select model..."
                className="h-6 text-2xs"
              />
            </div>
            <div className="flex items-center gap-4">
              {rembgModel === "ben2" && (
                <label className="flex items-center gap-1.5 text-2xs text-muted-foreground cursor-pointer">
                  <Checkbox checked={refine} onCheckedChange={setRefine} />
                  Refine
                </label>
              )}
              {rembgModel !== "ben2" && (
                <label className="flex items-center gap-1.5 text-2xs text-muted-foreground cursor-pointer">
                  <Checkbox checked={returnMask} onCheckedChange={setReturnMask} />
                  Mask only
                </label>
              )}
            </div>
            <Button
              type="button"
              onClick={submitRembg}
              disabled={!image || isRembg || isSubmittingRembg}
              size="sm"
              className="w-full"
            >
              {isRembg ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Removing...
                </>
              ) : (
                <>
                  <Play size={14} />
                  Remove Background
                </>
              )}
            </Button>
          </div>
        </SectionLeader>
      </div>
    </div>
  );
}
