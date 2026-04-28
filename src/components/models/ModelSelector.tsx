import {
  useModelList,
  useLoadModel,
  useRefreshModels,
  useReloadModel,
  useUnloadModel,
  useCurrentCheckpoint,
  useIsModelLoading,
} from "@/api/hooks/useModels";
import { useAllCloudModels } from "@/api/hooks/useCloudModels";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { useOptionsSubset } from "@/api/hooks/useSettings";
import type { LocalModel, CloudModel } from "@/api/types/cloud";
import {
  RefreshCw,
  ChevronsUpDown,
  ArrowBigDownDash,
  FolderSync,
  Cloud,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

function formatPipelineClass(cls: string | null | undefined): string | null {
  if (!cls) return null;
  return cls.replace(/Pipeline$/, "").replace(/Img2Img$|Inpaint$/, "");
}

function formatPricing(pricing: CloudModel["pricing"]): string {
  if (!pricing) return "";
  if (pricing.per_image) return `$${pricing.per_image}/img`;
  if (pricing.prompt_token) {
    const perMil = parseFloat(pricing.prompt_token) * 1_000_000;
    if (perMil < 1) return `$${perMil.toFixed(2)}/M`;
    return `$${perMil.toFixed(0)}/M`;
  }
  return "";
}

export function ModelSelector() {
  const { data: models } = useModelList();
  const { data: cloudData } = useAllCloudModels();
  const { data: options } = useOptionsSubset(["sd_model_checkpoint"]);
  const { data: checkpoint } = useCurrentCheckpoint();
  const { activeModel, isCloud, selectLocal, selectCloud } = useModelSelectionStore();
  const loadModel = useLoadModel();
  const reloadModel = useReloadModel();
  const unloadModel = useUnloadModel();
  const refreshModels = useRefreshModels();
  const isModelLoading = useIsModelLoading();

  const [open, setOpen] = useState(false);

  const displayName = isCloud
    ? (activeModel as CloudModel)?.name ?? "Cloud model"
    : (options?.sd_model_checkpoint as string) ?? "No model loaded";

  const pipelineClass = !isCloud ? formatPipelineClass(checkpoint?.class_name) : null;

  async function handleSelectLocal(model: typeof models extends (infer T)[] | undefined ? T : never) {
    if (!model) return;
    setOpen(false);
    const localModel: LocalModel = { ...model, source: "local" };
    selectLocal(localModel);
    try {
      await loadModel.mutateAsync(model.title);
      toast.success("Model loaded", { description: model.title });
    } catch (err) {
      toast.error("Failed to load model", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function handleSelectCloud(model: CloudModel) {
    setOpen(false);
    selectCloud(model);
    toast.success("Cloud model selected", { description: model.name });
  }

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            disabled={isModelLoading}
            className={cn(
              "min-w-0 max-w-md justify-between text-xs h-7 px-2",
              isModelLoading && "opacity-60",
            )}
          >
            <span className="flex items-center gap-2 truncate">
              {isModelLoading && (
                <RefreshCw size={12} className="animate-spin flex-shrink-0" />
              )}
              {isCloud && <Cloud size={12} className="flex-shrink-0 text-sky-400" />}
              <span className="truncate">{displayName}</span>
            </span>
            <ChevronsUpDown size={12} className="flex-shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[25rem] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search models..." />
            <CommandList>
              <CommandEmpty>No models found</CommandEmpty>

              <CommandGroup heading="Local">
                {models?.map((model) => (
                  <CommandItem
                    key={model.hash || model.title}
                    value={model.title}
                    onSelect={() => handleSelectLocal(model)}
                    className={cn(
                      "text-xs",
                      !isCloud && model.title === (options?.sd_model_checkpoint as string) &&
                        "font-semibold !text-primary",
                    )}
                  >
                    <span className="truncate flex-1">{model.title}</span>
                    {model.hash && (
                      <span className="text-3xs text-muted-foreground font-mono pl-2">
                        {model.hash.slice(0, 8)}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>

              {cloudData?.map(({ provider, models: cloudModels }) => (
                <CommandGroup key={provider.id} heading={provider.name}>
                  {cloudModels.map((model) => (
                    <CommandItem
                      key={`${provider.id}:${model.id}`}
                      value={`${provider.name} ${model.name} ${model.id}`}
                      onSelect={() => handleSelectCloud(model)}
                      className={cn(
                        "text-xs",
                        isCloud && (activeModel as CloudModel)?.id === model.id &&
                          "font-semibold !text-primary",
                      )}
                    >
                      <Cloud size={12} className="flex-shrink-0 text-sky-400 mr-1.5" />
                      <span className="truncate flex-1">{model.name}</span>
                      {model.pricing && (
                        <span className="text-3xs text-muted-foreground font-mono pl-2">
                          {formatPricing(model.pricing)}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {pipelineClass && (
        <span className="text-3xs text-muted-foreground whitespace-nowrap">
          {pipelineClass}
        </span>
      )}
      {isCloud && (
        <span className="text-3xs text-sky-400 whitespace-nowrap">Cloud</span>
      )}

      {!isCloud && (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Reload model"
            disabled={isModelLoading}
            onClick={() => reloadModel.mutate(undefined)}
          >
            <RefreshCw size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Unload model"
            disabled={isModelLoading}
            onClick={() => unloadModel.mutate(undefined)}
          >
            <ArrowBigDownDash size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Refresh model list"
            disabled={isModelLoading}
            onClick={() => refreshModels.mutate(undefined)}
          >
            <FolderSync size={14} />
          </Button>
        </>
      )}
    </div>
  );
}
