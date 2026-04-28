import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import type { CloudModel, Modality } from "@/api/types/cloud";

interface ModelBrowserProps {
  models: CloudModel[];
}

const MODALITY_LABELS: Partial<Record<Modality, string>> = {
  "text-to-image": "Image Generation",
  "image-to-image": "Image Editing",
  chat: "Chat / LLM",
  vision: "Vision",
  "audio-out": "Text to Speech",
  "audio-in": "Speech to Text",
  "text-to-video": "Video Generation",
  "image-to-video": "Video (img2vid)",
};

const MODALITY_ORDER: Modality[] = [
  "text-to-image", "image-to-image", "chat", "vision",
  "audio-out", "audio-in", "text-to-video", "image-to-video",
];

function formatPricing(model: CloudModel): string {
  const p = model.pricing;
  if (!p) return "";
  if (p.per_image) return `$${p.per_image}/img`;
  if (p.prompt_token) {
    const perMil = parseFloat(p.prompt_token) * 1_000_000;
    return perMil < 1 ? `$${perMil.toFixed(2)}/M` : `$${perMil.toFixed(0)}/M`;
  }
  if (p.per_request) return `$${p.per_request}/req`;
  return "";
}

export function ModelBrowser({ models }: ModelBrowserProps) {
  const [search, setSearch] = useState("");
  const [modalityFilter, setModalityFilter] = useState<Modality | null>(null);

  const availableModalities = useMemo(() => {
    const set = new Set<Modality>();
    for (const m of models) {
      for (const mod of m.modalities) {
        set.add(mod);
      }
    }
    return MODALITY_ORDER.filter((m) => set.has(m));
  }, [models]);

  const filtered = useMemo(() => {
    let result = models;
    if (modalityFilter) {
      result = result.filter((m) => m.modalities.includes(modalityFilter));
    }
    if (search) {
      const lower = search.toLowerCase();
      result = result.filter(
        (m) => m.name.toLowerCase().includes(lower) || m.id.toLowerCase().includes(lower),
      );
    }
    return result;
  }, [models, search, modalityFilter]);

  const grouped = useMemo(() => {
    const groups = new Map<Modality, CloudModel[]>();
    for (const model of filtered) {
      const primary = model.modalities[0] ?? "chat";
      if (!groups.has(primary)) groups.set(primary, []);
      groups.get(primary)!.push(model);
    }
    return MODALITY_ORDER
      .filter((m) => groups.has(m))
      .map((m) => ({ modality: m, models: groups.get(m)! }));
  }, [filtered]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter models..."
          className="h-6 text-3xs pl-7"
        />
      </div>

      {availableModalities.length > 1 && (
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setModalityFilter(null)}
            className={`text-4xs px-1.5 py-0.5 rounded-sm border transition-colors ${
              !modalityFilter
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/30"
            }`}
          >
            All
          </button>
          {availableModalities.map((mod) => (
            <button
              key={mod}
              onClick={() => setModalityFilter(modalityFilter === mod ? null : mod)}
              className={`text-4xs px-1.5 py-0.5 rounded-sm border transition-colors ${
                modalityFilter === mod
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/30"
              }`}
            >
              {MODALITY_LABELS[mod] ?? mod}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2 max-h-[300px] overflow-y-auto">
        {grouped.map(({ modality, models: groupModels }) => (
          <div key={modality}>
            <div className="text-2xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
              {MODALITY_LABELS[modality] ?? modality}
            </div>
            <div className="space-y-0.5">
              {groupModels.slice(0, 20).map((model) => (
                <ModelRow key={model.id} model={model} />
              ))}
              {groupModels.length > 20 && (
                <p className="text-4xs text-muted-foreground/60 pl-1">
                  +{groupModels.length - 20} more
                </p>
              )}
            </div>
          </div>
        ))}

        {grouped.length === 0 && (
          <p className="text-3xs text-muted-foreground text-center py-2">
            No models match filter
          </p>
        )}
      </div>
    </div>
  );
}

function ModelRow({ model }: { model: CloudModel }) {
  const price = formatPricing(model);
  return (
    <div className="flex items-center gap-1.5 px-1.5 py-1 rounded-sm hover:bg-accent/30 transition-colors">
      <span className="text-3xs flex-1 truncate">{model.name}</span>
      {price && (
        <span className="text-4xs text-muted-foreground font-mono tabular-nums whitespace-nowrap">
          {price}
        </span>
      )}
      {model.capabilities.slice(0, 2).map((cap) => (
        <span
          key={cap}
          className="text-4xs px-1 py-0.5 rounded-sm bg-accent text-muted-foreground whitespace-nowrap"
        >
          {cap}
        </span>
      ))}
    </div>
  );
}
