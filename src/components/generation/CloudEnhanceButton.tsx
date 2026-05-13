import { useState, useMemo, useCallback } from "react";
import { Cloud, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useGenerationStore } from "@/stores/generationStore";
import { useCloudTextStore } from "@/stores/cloudTextStore";
import { useAllCloudModels } from "@/api/hooks/useCloudModels";
import { useCloudPromptEnhance } from "@/api/hooks/useCloudText";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Combobox } from "@/components/ui/combobox";
import { Textarea } from "@/components/ui/textarea";

export function CloudEnhanceButton() {
  const prompt = useGenerationStore((s) => s.prompt);
  const setParam = useGenerationStore((s) => s.setParam);

  const slot = useCloudTextStore((s) => s.enhance);
  const systemPrompt = useCloudTextStore((s) => s.enhanceSystemPrompt);
  const nsfw = useCloudTextStore((s) => s.enhanceNsfw);
  const setSlot = useCloudTextStore((s) => s.setSlot);
  const setSystemPrompt = useCloudTextStore((s) => s.setEnhanceSystemPrompt);
  const setNsfw = useCloudTextStore((s) => s.setEnhanceNsfw);

  const { data: cloudData } = useAllCloudModels();
  const enhanceMutation = useCloudPromptEnhance();
  const [open, setOpen] = useState(false);

  // Filter to chat-capable cloud models, grouped by provider.
  const providersWithModels = useMemo(() => {
    if (!cloudData) return [];
    return cloudData
      .map(({ provider, models }) => ({
        provider,
        models: models.filter((m) => m.modalities.includes("chat")),
      }))
      .filter((g) => g.models.length > 0);
  }, [cloudData]);

  const providerOptions = useMemo(
    () => providersWithModels.map((g) => ({ value: g.provider.id, label: g.provider.name })),
    [providersWithModels],
  );

  const modelOptions = useMemo(() => {
    const g = providersWithModels.find((g) => g.provider.id === slot.provider);
    return (g?.models ?? []).map((m) => ({ value: m.id, label: m.name }));
  }, [providersWithModels, slot.provider]);

  const handleEnhance = useCallback(() => {
    if (!prompt.trim()) {
      toast.warning("Enter a prompt first");
      return;
    }
    if (!slot.provider || !slot.model) {
      toast.warning("Pick a cloud provider and model");
      return;
    }
    enhanceMutation.mutate(
      {
        prompt,
        provider: slot.provider,
        model: slot.model,
        system_prompt: systemPrompt || undefined,
        nsfw,
      },
      {
        onSuccess: (res) => {
          setParam("prompt", res.enhanced);
          toast.success(`Enhanced via ${res.provider} / ${res.model}`);
          setOpen(false);
        },
        onError: (err) => {
          toast.error("Cloud enhance failed", {
            description: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  }, [prompt, slot, systemPrompt, nsfw, enhanceMutation, setParam]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          title="Enhance prompt via cloud"
          disabled={enhanceMutation.isPending}
        >
          {enhanceMutation.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Cloud size={14} className="text-sky-400/80" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-80 p-3 space-y-3">
        <div className="space-y-1">
          <div className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
            Cloud Enhance
          </div>
          {providersWithModels.length === 0 ? (
            <p className="text-3xs text-muted-foreground leading-snug">
              No chat-capable cloud models configured. Add a provider via the Providers panel.
            </p>
          ) : null}
        </div>

        {providersWithModels.length > 0 && (
          <>
            <div className="space-y-1">
              <span className="text-2xs text-muted-foreground">Provider</span>
              <Combobox
                value={slot.provider}
                onValueChange={(v) => setSlot("enhance", { provider: v, model: "" })}
                options={providerOptions}
                placeholder="Pick provider..."
                className="h-7 text-2xs"
              />
            </div>

            <div className="space-y-1">
              <span className="text-2xs text-muted-foreground">Model</span>
              <Combobox
                value={slot.model}
                onValueChange={(v) => setSlot("enhance", { provider: slot.provider, model: v })}
                options={modelOptions}
                placeholder={slot.provider ? "Pick model..." : "Pick provider first"}
                className="h-7 text-2xs"
              />
            </div>

            <div className="space-y-1">
              <span className="text-2xs text-muted-foreground">System prompt (optional)</span>
              <Textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Leave empty for default"
                rows={2}
                className="text-2xs"
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-2xs text-muted-foreground">Allow NSFW</span>
              <Switch checked={nsfw} onCheckedChange={setNsfw} className="scale-75" />
            </div>

            <Button
              onClick={handleEnhance}
              disabled={!slot.provider || !slot.model || enhanceMutation.isPending}
              size="sm"
              className="w-full"
            >
              {enhanceMutation.isPending ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Enhancing...
                </>
              ) : (
                "Enhance"
              )}
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
