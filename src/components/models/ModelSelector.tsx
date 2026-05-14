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
import {
  useLocalVideoModels,
  useLoadVideoModel,
  useLoadFramePack,
  useUnloadFramePack,
} from "@/api/hooks/useVideo";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { useUiStore } from "@/stores/uiStore";
import { useVideoStore } from "@/stores/videoStore";
import { useOptionsSubset } from "@/api/hooks/useSettings";
import { useQueryClient } from "@tanstack/react-query";
import type { LocalModel, LocalVideoModel, CloudModel } from "@/api/types/cloud";
import {
  RefreshCw,
  ChevronsUpDown,
  ArrowBigDownDash,
  FolderSync,
  Cloud,
  Film,
  Upload,
  RotateCw,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  const localVideoModels = useLocalVideoModels();
  const { data: options } = useOptionsSubset(["sd_model_checkpoint"]);
  const { data: checkpoint } = useCurrentCheckpoint();
  const activeModel = useModelSelectionStore((s) => s.activeModel);
  const setActiveModel = useModelSelectionStore((s) => s.setActiveModel);
  const activeNavView = useUiStore((s) => s.activeNavView);
  const queryClient = useQueryClient();

  // Image-side mutations (sdnext checkpoint registry).
  const loadModel = useLoadModel();
  const reloadModel = useReloadModel();
  const unloadModel = useUnloadModel();
  const refreshModels = useRefreshModels();
  const isModelLoading = useIsModelLoading();

  // Video-side mutations.
  const loadVideoModel = useLoadVideoModel();
  const loadFramePack = useLoadFramePack();
  const unloadFramePack = useUnloadFramePack();

  const [open, setOpen] = useState(false);

  const isCloud = activeModel?.source === "cloud";
  const isLocalImage = activeModel?.source === "local";
  const isLocalVideo = activeModel?.source === "local-video";
  const isFramePackActive = isLocalVideo && activeModel.kind === "framepack";

  const showLocalImage = activeNavView !== "video";
  const showCloudImage = activeNavView === "images";
  const showLocalVideo = activeNavView === "video";
  const showCloudVideo = activeNavView === "video";

  // Display name follows activeModel directly - manual-load semantics mean
  // "what's selected" is the most useful indicator. Falls back to the
  // server-loaded checkpoint when no model is selected so first-load shows
  // something meaningful.
  const displayName = isCloud
    ? (activeModel.name ?? "Cloud model")
    : isLocalVideo
      ? activeModel.name
      : isLocalImage
        ? activeModel.title
        : ((options?.["sd_model_checkpoint"] as string) ?? "No model selected");

  const pipelineClass = isLocalImage ? formatPipelineClass(checkpoint?.class_name) : null;

  function handleSelectLocal(model: NonNullable<typeof models>[number]) {
    setOpen(false);
    const localModel: LocalModel = { ...model, source: "local" };
    setActiveModel(localModel);
    toast.success("Model selected", { description: model.title });
  }

  function handleSelectLocalVideo(model: LocalVideoModel) {
    setOpen(false);
    setActiveModel(model);
    toast.success("Video model selected", { description: `${model.engine} / ${model.name}` });
  }

  function handleSelectCloud(model: CloudModel) {
    setOpen(false);
    setActiveModel(model);
    toast.success("Cloud model selected", { description: model.name });
  }

  // Group local video models by engine for the dropdown. Memoised against
  // the list reference; useLocalVideoModels already memoises internally.
  const localVideoByEngine = useMemo(() => {
    const map = new Map<string, LocalVideoModel[]>();
    for (const m of localVideoModels) {
      const bucket = map.get(m.engine) ?? [];
      bucket.push(m);
      map.set(m.engine, bucket);
    }
    return Array.from(map.entries());
  }, [localVideoModels]);

  // --- Action row dispatch -------------------------------------------------

  // Load button: dispatches per source. Cloud is a no-op (selection is the
  // configuration). FramePack uses its dedicated endpoint with the current
  // fpAttention from videoStore as the default.
  function handleLoad() {
    if (!activeModel) return;
    if (activeModel.source === "local") {
      loadModel.mutate(activeModel.title);
    } else if (activeModel.source === "local-video") {
      if (activeModel.kind === "framepack") {
        const attention = useVideoStore.getState().fpAttention;
        loadFramePack.mutate({ variant: activeModel.model, attention });
      } else {
        loadVideoModel.mutate({ engine: activeModel.engine, model: activeModel.model });
      }
    }
  }

  // Reload re-fires the appropriate load. For sdnext, the dedicated reload
  // endpoint re-pulls the currently-loaded checkpoint. For local video, we
  // fire load with the active model again - there's no separate /reload
  // route, and re-firing load achieves the "re-pull from disk" effect.
  function handleReload() {
    if (!activeModel) return;
    if (activeModel.source === "local") {
      reloadModel.mutate(undefined);
    } else if (activeModel.source === "local-video") {
      if (activeModel.kind === "framepack") {
        const attention = useVideoStore.getState().fpAttention;
        loadFramePack.mutate({ variant: activeModel.model, attention });
      } else {
        loadVideoModel.mutate({ engine: activeModel.engine, model: activeModel.model });
      }
    }
  }

  // Unload: sdnext has /options unload; FramePack has /framepack/unload; the
  // generic /video/load endpoint has no unload counterpart, so generic and
  // LTX local-video models leave the Unload button muted.
  function handleUnload() {
    if (!activeModel) return;
    if (activeModel.source === "local") {
      unloadModel.mutate(undefined);
    } else if (isFramePackActive) {
      unloadFramePack.mutate();
    }
  }

  // Refresh invalidates every model-list query in one shot. Cheap (small
  // JSON responses) and keeps Refresh as a context-free "reload all lists"
  // button so the user doesn't need to think about which list to refresh.
  function handleRefresh() {
    refreshModels.mutate(undefined);
    void queryClient.invalidateQueries({ queryKey: ["video-engines"] });
    void queryClient.invalidateQueries({ queryKey: ["framepack-variants"] });
    void queryClient.invalidateQueries({ queryKey: ["cloud-models-all"] });
  }

  const canLoadOrReload = activeModel != null && activeModel.source !== "cloud";
  const canUnload = isLocalImage || isFramePackActive;
  const anyVideoMutationPending =
    loadVideoModel.isPending || loadFramePack.isPending || unloadFramePack.isPending;
  const anyLoadActionPending = isModelLoading || anyVideoMutationPending;

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
              {isModelLoading && <RefreshCw size={12} className="animate-spin flex-shrink-0" />}
              {isCloud && <Cloud size={12} className="flex-shrink-0 text-sky-400" />}
              {isLocalVideo && <Film size={12} className="flex-shrink-0 text-emerald-400" />}
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

              {/* Local checkpoints: image-only. Hide on Video view where
                  they can't run. */}
              {showLocalImage && (
                <CommandGroup heading="Local">
                  {models?.map((model) => (
                    <CommandItem
                      key={model.hash || model.title}
                      value={model.title}
                      onSelect={() => handleSelectLocal(model)}
                      className={cn(
                        "text-xs",
                        isLocalImage &&
                          activeModel.title === model.title &&
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
              )}

              {/* Local video models, grouped by engine. Wan/Hunyuan/LTX
                  come from /sdapi/v2/video/engines with full metadata;
                  FramePack variants come from /sdapi/v2/framepack/variants
                  as bare strings (no cached/loaded badges available). */}
              {showLocalVideo &&
                localVideoByEngine.map(([engine, engineModels]) => (
                  <CommandGroup key={`lv-${engine}`} heading={engine}>
                    {engineModels.map((m) => (
                      <CommandItem
                        key={m.title}
                        value={`${engine} ${m.name}`}
                        onSelect={() => handleSelectLocalVideo(m)}
                        className={cn(
                          "text-xs",
                          isLocalVideo &&
                            activeModel.engine === m.engine &&
                            activeModel.model === m.model &&
                            "font-semibold !text-primary",
                        )}
                      >
                        <Film size={12} className="flex-shrink-0 text-emerald-400 mr-1.5" />
                        {m.loaded ? (
                          <span
                            className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mr-1"
                            title="Loaded"
                          />
                        ) : m.cached ? (
                          <span
                            className="w-2 h-2 rounded-full bg-green-500 shrink-0 mr-1"
                            title="Cached"
                          />
                        ) : null}
                        <span className="truncate flex-1">{m.name}</span>
                        {m.mode !== "t2v" && (
                          <span className="text-4xs font-medium uppercase bg-muted px-1 rounded shrink-0 ml-2">
                            {m.mode}
                          </span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}

              {/* Cloud models, split by modality and gated by the active
                  view. Picking a cloud model on a view that can't generate
                  with it would be a dead-end. */}
              {showCloudImage &&
                cloudData?.map(({ provider, models: cloudModels }) => {
                  const imageModels = cloudModels.filter((m) =>
                    m.modalities.some((mod) => mod === "text-to-image" || mod === "image-to-image"),
                  );
                  if (imageModels.length === 0) return null;
                  return (
                    <CommandGroup key={`img-${provider.id}`} heading={provider.name}>
                      {imageModels.map((model) => (
                        <CommandItem
                          key={`${provider.id}:${model.id}`}
                          value={`${provider.name} ${model.name} ${model.id}`}
                          onSelect={() => handleSelectCloud(model)}
                          className={cn(
                            "text-xs",
                            isCloud &&
                              activeModel.provider === provider.id &&
                              activeModel.id === model.id &&
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
                  );
                })}

              {showCloudVideo &&
                cloudData?.map(({ provider, models: cloudModels }) => {
                  const videoModels = cloudModels.filter((m) =>
                    m.modalities.some((mod) => mod === "text-to-video" || mod === "image-to-video"),
                  );
                  if (videoModels.length === 0) return null;
                  return (
                    <CommandGroup key={`vid-${provider.id}`} heading={provider.name}>
                      {videoModels.map((model) => (
                        <CommandItem
                          key={`${provider.id}:${model.id}`}
                          value={`${provider.name} ${model.name} ${model.id}`}
                          onSelect={() => handleSelectCloud(model)}
                          className={cn(
                            "text-xs",
                            isCloud &&
                              activeModel.provider === provider.id &&
                              activeModel.id === model.id &&
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
                  );
                })}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {pipelineClass && (
        <span className="text-3xs text-muted-foreground whitespace-nowrap">{pipelineClass}</span>
      )}
      {isCloud && <span className="text-3xs text-sky-400 whitespace-nowrap">Cloud</span>}
      {isLocalVideo && <span className="text-3xs text-emerald-400 whitespace-nowrap">Video</span>}

      {/* Unified action row: always visible. Load/Reload/Unload mute when
          they wouldn't do anything (cloud active, or Unload on a
          generic/LTX video model where no unload endpoint exists). Refresh
          stays active everywhere since invalidating list queries is a
          context-free escape hatch. */}
      <Button
        variant="ghost"
        size="icon-sm"
        title="Load selected model"
        disabled={!canLoadOrReload || anyLoadActionPending}
        onClick={handleLoad}
      >
        <Upload size={14} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        title="Reload current model"
        disabled={!canLoadOrReload || anyLoadActionPending}
        onClick={handleReload}
      >
        <RotateCw size={14} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        title="Unload current model"
        disabled={!canUnload || anyLoadActionPending}
        onClick={handleUnload}
      >
        <ArrowBigDownDash size={14} />
      </Button>
      <Button variant="ghost" size="icon-sm" title="Refresh model lists" onClick={handleRefresh}>
        <FolderSync size={14} />
      </Button>
    </div>
  );
}
