import { useMemo } from "react";
import { useCloudTextStore } from "@/stores/cloudTextStore";
import { useCaptionStore } from "@/stores/captionStore";
import { useAllCloudModels } from "@/api/hooks/useCloudModels";
import { useCloudDefaults } from "@/hooks/useCloudDefaults";
import { Combobox } from "@/components/ui/combobox";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";

export function CloudCaptionSettings() {
  const cloudMode = useCaptionStore((s) => s.cloudMode);
  const setCloudMode = useCaptionStore((s) => s.setCloudMode);

  const slot = useCloudTextStore((s) => (cloudMode === "caption" ? s.caption : s.vqa));
  const setSlot = useCloudTextStore((s) => s.setSlot);
  const captionPrompt = useCloudTextStore((s) => s.captionPrompt);
  const setCaptionPrompt = useCloudTextStore((s) => s.setCaptionPrompt);
  const vqaQuestion = useCloudTextStore((s) => s.vqaQuestion);
  const setVqaQuestion = useCloudTextStore((s) => s.setVqaQuestion);

  const { data: cloudData } = useAllCloudModels();
  const defaults = useCloudDefaults();

  // Cloud caption/VQA both need vision-capable models. Same filter.
  const providersWithModels = useMemo(() => {
    if (!cloudData) return [];
    return cloudData
      .map(({ provider, models }) => ({
        provider,
        models: models.filter((m) => m.modalities.includes("vision")),
      }))
      .filter((g) => g.models.length > 0);
  }, [cloudData]);

  const providerOptions = useMemo(
    () => providersWithModels.map((g) => ({ value: g.provider.id, label: g.provider.name })),
    [providersWithModels],
  );

  // Until the user picks, fall back to sdnext's configured default vision
  // provider (cloud_default_vision_provider, then cloud_default_provider).
  const effectiveProvider = slot.provider || defaults.vision;

  const modelOptions = useMemo(() => {
    const g = providersWithModels.find((g) => g.provider.id === effectiveProvider);
    return (g?.models ?? []).map((m) => ({ value: m.id, label: m.name }));
  }, [providersWithModels, effectiveProvider]);

  const slotKey = cloudMode === "caption" ? "caption" : "vqa";

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
          Mode
        </span>
        <SegmentedControl
          options={[
            { value: "caption", label: "Describe" },
            { value: "vqa", label: "Ask" },
          ]}
          value={cloudMode}
          onValueChange={setCloudMode}
          animated
        />
      </div>

      {providersWithModels.length === 0 ? (
        <p className="text-3xs text-muted-foreground leading-snug">
          No vision-capable cloud models configured. Add a provider (and a vision model like gpt-4o
          or gemini-flash) via the Providers panel.
        </p>
      ) : (
        <>
          <div className="space-y-1">
            <span className="text-2xs text-muted-foreground">Provider</span>
            <Combobox
              value={effectiveProvider}
              onValueChange={(v) => setSlot(slotKey, { provider: v, model: "" })}
              options={providerOptions}
              placeholder="Pick provider..."
              className="h-7 text-2xs"
            />
          </div>

          <div className="space-y-1">
            <span className="text-2xs text-muted-foreground">Model</span>
            <Combobox
              value={slot.model}
              onValueChange={(v) => setSlot(slotKey, { provider: effectiveProvider, model: v })}
              options={modelOptions}
              placeholder={effectiveProvider ? "Pick model..." : "Pick provider first"}
              className="h-7 text-2xs"
            />
          </div>

          {cloudMode === "caption" ? (
            <div className="space-y-1">
              <span className="text-2xs text-muted-foreground">Caption prompt</span>
              <Textarea
                value={captionPrompt}
                onChange={(e) => setCaptionPrompt(e.target.value)}
                rows={2}
                className="text-2xs"
              />
            </div>
          ) : (
            <div className="space-y-1">
              <span className="text-2xs text-muted-foreground">Question</span>
              <Textarea
                value={vqaQuestion}
                onChange={(e) => setVqaQuestion(e.target.value)}
                placeholder="What color is the cat?"
                rows={3}
                className="text-2xs"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
