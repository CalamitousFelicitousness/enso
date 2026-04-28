import { useState } from "react";
import { useCloudProviders } from "@/api/hooks/useCloudModels";
import { ProviderCard } from "@/components/providers/ProviderCard";
import { ProviderForm } from "@/components/providers/ProviderForm";
import { Button } from "@/components/ui/button";
import { Plus, CloudOff } from "lucide-react";
import type { ProviderPreset } from "@/api/types/cloud";

const PRESET_OPTIONS: { preset: ProviderPreset; label: string; description: string }[] = [
  { preset: "openrouter", label: "OpenRouter", description: "200+ models, free tiers" },
  { preset: "openai", label: "OpenAI", description: "GPT-Image, DALL-E, GPT-4o" },
  { preset: "nanogpt", label: "NanoGPT", description: "Privacy-focused, pay-as-you-go" },
  { preset: "aihubmix", label: "AIHubMix", description: "Chinese model access" },
  { preset: "ollama", label: "Ollama", description: "Local models, no key needed" },
  { preset: "custom", label: "Custom", description: "Any OpenAI-compatible endpoint" },
];

export function ProvidersTab() {
  const { data: providers, isLoading } = useCloudProviders();
  const [showForm, setShowForm] = useState(false);
  const [formPreset, setFormPreset] = useState<ProviderPreset | null>(null);

  function handleQuickAdd(preset: ProviderPreset) {
    setFormPreset(preset);
    setShowForm(true);
  }

  function handleFormClose() {
    setShowForm(false);
    setFormPreset(null);
  }

  if (isLoading) {
    return (
      <div className="p-4 text-xs text-muted-foreground">Loading providers...</div>
    );
  }

  const hasProviders = providers && providers.length > 0;

  return (
    <div className="p-3 space-y-3">
      {showForm && (
        <ProviderForm
          initialPreset={formPreset}
          onClose={handleFormClose}
        />
      )}

      {hasProviders && !showForm && (
        <div className="flex items-center justify-end">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowForm(true)}
          >
            <Plus size={14} className="mr-1" />
            Add Provider
          </Button>
        </div>
      )}

      {hasProviders ? (
        <div className="space-y-2">
          {providers.map((provider) => (
            <ProviderCard key={provider.id} provider={provider} />
          ))}
        </div>
      ) : !showForm ? (
        <EmptyState onQuickAdd={handleQuickAdd} />
      ) : null}
    </div>
  );
}

function EmptyState({ onQuickAdd }: { onQuickAdd: (preset: ProviderPreset) => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-8">
      <CloudOff size={32} className="text-muted-foreground/50" />
      <div className="text-center">
        <p className="text-xs font-medium text-muted-foreground">No providers configured</p>
        <p className="text-3xs text-muted-foreground/70 mt-1">
          Add a cloud provider to access remote models
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 w-full max-w-xs">
        {PRESET_OPTIONS.map(({ preset, label, description }) => (
          <button
            key={preset}
            onClick={() => onQuickAdd(preset)}
            className="flex flex-col items-start gap-0.5 p-2.5 rounded-md border border-border hover:border-primary/30 hover:bg-accent/50 transition-colors text-left"
          >
            <span className="text-xs font-medium">{label}</span>
            <span className="text-3xs text-muted-foreground">{description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
