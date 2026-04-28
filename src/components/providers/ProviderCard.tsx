import { useState } from "react";
import {
  useRemoveProvider,
  useRefreshProvider,
  useValidateProvider,
  useCloudModels,
} from "@/api/hooks/useCloudModels";
import { ModelBrowser } from "./ModelBrowser";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  RefreshCw,
  Trash2,
  ShieldCheck,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import type { Provider } from "@/api/types/cloud";
import { useAddProvider } from "@/api/hooks/useCloudModels";

interface ProviderCardProps {
  provider: Provider;
}

export function ProviderCard({ provider }: ProviderCardProps) {
  const [expanded, setExpanded] = useState(false);
  const removeProvider = useRemoveProvider();
  const refreshProvider = useRefreshProvider();
  const validateProvider = useValidateProvider();
  const { data: models } = useCloudModels(expanded ? provider.id : "");

  const addProvider = useAddProvider();

  function handleToggleEnabled() {
    addProvider.mutate({
      name: provider.name,
      preset: provider.preset,
      base_url: provider.base_url,
    });
  }

  async function handleValidate() {
    const result = await validateProvider.mutateAsync(provider.id);
    if (result.valid) {
      toast.success(`${provider.name} key is valid`);
    } else {
      toast.error(`${provider.name} validation failed`, { description: result.error });
    }
  }

  async function handleRefresh() {
    try {
      const result = await refreshProvider.mutateAsync(provider.id);
      toast.success(`${provider.name}: ${result.model_count} models loaded`);
    } catch (err) {
      toast.error(`Failed to refresh ${provider.name}`, {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleRemove() {
    try {
      await removeProvider.mutateAsync(provider.id);
      toast.success(`Removed ${provider.name}`);
    } catch (err) {
      toast.error("Failed to remove provider", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const statusColor = provider.status === "ok"
    ? "bg-emerald-400"
    : provider.status === "error"
      ? "bg-red-400"
      : "bg-zinc-400";

  return (
    <div className="rounded-md border border-border overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 hover:bg-accent/30 transition-colors text-left"
      >
        <span className={cn("w-2 h-2 rounded-full flex-shrink-0", statusColor)} />
        <span className="text-xs font-medium flex-1 truncate">{provider.name}</span>
        <span className="text-3xs text-muted-foreground font-mono">
          {provider.model_count > 0 ? `${provider.model_count} models` : provider.preset}
        </span>
        <ChevronDown
          size={14}
          className={cn(
            "text-muted-foreground transition-transform duration-200",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-3">
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-3xs"
              onClick={handleValidate}
              disabled={validateProvider.isPending}
            >
              <ShieldCheck size={12} className="mr-1" />
              Validate
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-3xs"
              onClick={handleRefresh}
              disabled={refreshProvider.isPending}
            >
              <RefreshCw size={12} className={cn("mr-1", refreshProvider.isPending && "animate-spin")} />
              Refresh
            </Button>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-3xs text-destructive hover:text-destructive"
              onClick={handleRemove}
              disabled={removeProvider.isPending}
            >
              <Trash2 size={12} className="mr-1" />
              Remove
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-3xs text-muted-foreground">
              {provider.base_url}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-3xs text-muted-foreground">Enabled</span>
              <Switch
                checked={provider.enabled}
                onCheckedChange={handleToggleEnabled}
                className="scale-75"
              />
            </div>
          </div>

          {provider.error && (
            <p className="text-3xs text-destructive">{provider.error}</p>
          )}

          {models && models.length > 0 && (
            <ModelBrowser models={models} />
          )}
        </div>
      )}
    </div>
  );
}
