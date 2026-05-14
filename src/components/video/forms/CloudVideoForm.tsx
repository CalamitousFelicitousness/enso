import { useMemo } from "react";
import { Cloud, Film } from "lucide-react";
import { useVideoStore } from "@/stores/videoStore";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { isCloudVideoModel, supportsImageToVideo } from "@/lib/cloudVideo";
import { Combobox } from "@/components/ui/combobox";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";

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

export function CloudVideoForm() {
  const activeModel = useModelSelectionStore((s) => s.activeModel);
  const cloudAspectRatio = useVideoStore((s) => s.cloudAspectRatio);
  const cloudDuration = useVideoStore((s) => s.cloudDuration);
  const initImage = useVideoStore((s) => s.initImage);
  const setParam = useVideoStore((s) => s.setParam);

  const isVideo = isCloudVideoModel(activeModel);
  const canI2V = useMemo(
    () => (isVideo && activeModel ? supportsImageToVideo(activeModel) : false),
    [isVideo, activeModel],
  );

  if (!isVideo || !activeModel) {
    // Empty state. The model selector at the top is the entry point; we keep
    // this guidance short rather than re-implementing a provider/model picker
    // here (cloud video parity with cloud image, which also doesn't have a
    // panel-internal picker).
    return (
      <div className="p-4 space-y-2">
        <div className="flex items-center gap-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
          <Cloud size={14} className="text-sky-400" />
          Cloud video
        </div>
        <p className="text-3xs text-muted-foreground leading-snug">
          Pick a cloud video model from the model selector above to configure and run it from this
          tab.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
        <Cloud size={14} className="text-sky-400" />
        {formatModelName(activeModel.provider, activeModel.name)}
      </div>

      <div className="flex items-center gap-2">
        <Label className="text-2xs text-muted-foreground w-20 shrink-0">Aspect</Label>
        <Combobox
          value={cloudAspectRatio}
          onValueChange={(v) => setParam("cloudAspectRatio", v)}
          options={ASPECT_RATIOS}
          placeholder="Pick aspect ratio..."
          className="h-7 text-2xs flex-1"
        />
      </div>

      <div className="flex items-center gap-2">
        <Label className="text-2xs text-muted-foreground w-20 shrink-0">Duration</Label>
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
