import { useMemo } from "react";
import { Cloud, Film } from "lucide-react";
import { useVideoStore } from "@/stores/videoStore";
import { useVideoCanvasStore } from "@/stores/videoCanvasStore";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { isCloudVideoModel, supportsImageToVideo } from "@/lib/cloudVideo";
import { Combobox } from "@/components/ui/combobox";
import { NumberInput } from "@/components/ui/number-input";
import { SectionLeader } from "@/components/ui/section-leader";
import { ParamRow } from "@/components/generation/ParamRow";

// Aspect ratios accepted by most cloud video providers. Sora-style providers
// (orientation: portrait|landscape|square) get covered by 9:16 / 16:9 / 1:1.
// NanoGPT / Kling expect the colon form directly. When a provider rejects a
// value, the backend surfaces a 400 with kind="input_validation". Per-model
// surface lives in CloudModel.supported_params; consuming that to derive the
// list per-model is a follow-up.
const ASPECT_RATIOS = [
  { value: "16:9", label: "16:9 (landscape)" },
  { value: "9:16", label: "9:16 (portrait)" },
  { value: "1:1", label: "1:1 (square)" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
];

function formatModelName(provider: string, name: string): string {
  return `${provider} / ${name}`;
}

export function CloudVideoSection() {
  const activeModel = useModelSelectionStore((s) => s.activeModel);
  const cloudAspectRatio = useVideoStore((s) => s.cloudAspectRatio);
  const cloudDuration = useVideoStore((s) => s.cloudDuration);
  const initImage = useVideoCanvasStore((s) => s.initFrame?.file ?? null);
  const setParam = useVideoStore((s) => s.setParam);

  const isVideo = isCloudVideoModel(activeModel);
  const canI2V = useMemo(
    () => (isVideo && activeModel ? supportsImageToVideo(activeModel) : false),
    [isVideo, activeModel],
  );

  // The Settings sub-tab is only visible for cloud models, so the
  // no-model case cannot render here.
  if (!isVideo || !activeModel) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
        <Cloud size={14} className="text-sky-400" />
        {formatModelName(activeModel.provider, activeModel.name)}
      </div>

      <SectionLeader title="Cloud">
        <ParamRow
          label="Aspect"
          tooltip="Frame shape the provider renders. Providers accept a fixed set of ratios; one they do not support is rejected at submit."
          keywords={["aspect ratio", "orientation", "landscape", "portrait", "square"]}
        >
          <Combobox
            value={cloudAspectRatio}
            onValueChange={(v) => setParam("cloudAspectRatio", v)}
            options={ASPECT_RATIOS}
            placeholder="Pick aspect ratio..."
            className="h-7 text-2xs w-full"
          />
        </ParamRow>

        <ParamRow
          label="Duration"
          tooltip="Clip length in seconds. Most providers bill by the second and cap the maximum; a value above the model's limit is rejected at submit."
          keywords={["length", "seconds", "clip length"]}
        >
          <div className="flex items-center gap-2">
            <NumberInput
              value={cloudDuration}
              onChange={(v) => setParam("cloudDuration", v)}
              min={1}
              max={60}
              step={1}
              className="h-7 text-2xs flex-1"
            />
            <span className="text-3xs text-muted-foreground">sec</span>
          </div>
        </ParamRow>
      </SectionLeader>

      {canI2V && (
        <div className="space-y-1 pt-1 border-t border-border/50">
          <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            <Film size={11} />
            Init image (image-to-video)
          </div>
          <p className="text-3xs text-muted-foreground leading-snug">
            {initImage
              ? `Using ${initImage.name}. Manage on the canvas.`
              : "Optional. Drop an image onto the init frame on the video canvas."}
          </p>
        </div>
      )}
    </div>
  );
}
