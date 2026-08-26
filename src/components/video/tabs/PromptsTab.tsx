import { useCallback } from "react";
import { useVideoStore } from "@/stores/videoStore";
import { PromptBlock } from "@/components/generation/PromptBlock";
import { videoInitVisionSource } from "../visionSource";
import { StylesSection } from "./prompts/StylesSection";
import { useVideoTabContext } from "./useVideoTabContext";

export function PromptsTab() {
  const { kind } = useVideoTabContext();
  const prompt = useVideoStore((s) => s.prompt);
  const negative = useVideoStore((s) => s.negative);
  const setParam = useVideoStore((s) => s.setParam);

  const setPrompt = useCallback((v: string) => setParam("prompt", v), [setParam]);
  const setNegative = useCallback((v: string) => setParam("negative", v), [setParam]);

  return (
    <div className="space-y-3">
      <PromptBlock
        value={prompt}
        onChange={setPrompt}
        negativeValue={negative}
        onNegativeChange={setNegative}
        // Cloud providers take no negative prompt on the wire.
        negativeMode={kind === "cloud" ? "hidden" : "always"}
        enhanceType="video"
        getVisionImage={videoInitVisionSource}
        placeholder="Describe the video..."
        negativePlaceholder="Negative prompt (optional)"
        className="min-h-15"
        negativeClassName="min-h-9"
      />
      {kind !== "cloud" && <StylesSection />}
    </div>
  );
}
