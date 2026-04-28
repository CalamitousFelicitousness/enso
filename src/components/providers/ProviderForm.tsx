import { useState } from "react";
import { useAddProvider } from "@/api/hooks/useCloudModels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { ProviderPreset } from "@/api/types/cloud";

const PRESET_URLS: Partial<Record<ProviderPreset, string>> = {
  openrouter: "https://openrouter.ai/api",
  openai: "https://api.openai.com",
  nanogpt: "https://nano-gpt.com/api",
  aihubmix: "https://aihubmix.com/v1",
  ollama: "http://localhost:11434",
  custom: "",
};

const PRESET_LABELS: Record<ProviderPreset, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  nanogpt: "NanoGPT",
  aihubmix: "AIHubMix",
  ollama: "Ollama",
  custom: "Custom Provider",
};

interface ProviderFormProps {
  initialPreset: ProviderPreset | null;
  onClose: () => void;
}

export function ProviderForm({ initialPreset, onClose }: ProviderFormProps) {
  const [preset, setPreset] = useState<ProviderPreset>(initialPreset ?? "custom");
  const [name, setName] = useState(initialPreset ? PRESET_LABELS[initialPreset] : "");
  const [baseUrl, setBaseUrl] = useState(initialPreset ? (PRESET_URLS[initialPreset] ?? "") : "");
  const [key, setKey] = useState("");

  const addProvider = useAddProvider();

  function handlePresetChange(newPreset: ProviderPreset) {
    setPreset(newPreset);
    setName(PRESET_LABELS[newPreset]);
    setBaseUrl(PRESET_URLS[newPreset] ?? "");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Provider name is required");
      return;
    }
    if (!baseUrl.trim() && preset === "custom") {
      toast.error("Base URL is required for custom providers");
      return;
    }

    try {
      await addProvider.mutateAsync({
        name: name.trim(),
        preset,
        base_url: baseUrl.trim() || (PRESET_URLS[preset] ?? ""),
        key: key.trim(),
      });
      toast.success(`Added ${name}`);
      onClose();
    } catch (err) {
      toast.error("Failed to add provider", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-md border border-primary/20 bg-accent/30 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">Add Provider</span>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onClose}>
          <X size={14} />
        </Button>
      </div>

      <div className="flex flex-wrap gap-1">
        {(Object.keys(PRESET_LABELS) as ProviderPreset[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => handlePresetChange(p)}
            className={`text-3xs px-2 py-1 rounded-sm border transition-colors ${
              preset === p
                ? "border-primary bg-primary/10 text-primary"
                : "border-border hover:border-primary/30"
            }`}
          >
            {PRESET_LABELS[p]}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <div>
          <Label className="text-3xs">Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name"
            className="h-7 text-xs"
          />
        </div>

        <div>
          <Label className="text-3xs">Base URL</Label>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
            className="h-7 text-xs font-mono"
          />
        </div>

        {preset !== "ollama" && (
          <div>
            <Label className="text-3xs">API Key</Label>
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-..."
              autoComplete="off"
              className="h-7 text-xs font-mono"
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button
          type="submit"
          size="sm"
          className="h-7 text-xs"
          disabled={addProvider.isPending}
        >
          {addProvider.isPending ? (
            <Loader2 size={12} className="mr-1 animate-spin" />
          ) : (
            <Check size={12} className="mr-1" />
          )}
          Add & Validate
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={onClose}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
