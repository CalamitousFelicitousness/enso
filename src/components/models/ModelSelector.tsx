import {
  useModelList,
  useLoadModel,
  useRefreshModels,
  useReloadModel,
  useUnloadModel,
  useCurrentCheckpoint,
  useIsModelLoading,
  useModelLoadingTarget,
} from "@/api/hooks/useModels";
import { useAllCloudModels } from "@/api/hooks/useCloudModels";
import {
  useLocalVideoModels,
  useLoadVideoModel,
  useLoadFramePack,
  useUnloadFramePack,
  useUnloadVideoModel,
} from "@/api/hooks/useVideo";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { useUiStore } from "@/stores/uiStore";
import { useVideoStore } from "@/stores/videoStore";
import { useOptionsSubset } from "@/api/hooks/useSettings";
import { useQueryClient } from "@tanstack/react-query";
import { VideoModelBadges } from "@/components/models/VideoModelBadges";
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
  const loadingTarget = useModelLoadingTarget();

  // Video-side mutations.
  const loadVideoModel = useLoadVideoModel();
  const loadFramePack = useLoadFramePack();
  const unloadFramePack = useUnloadFramePack();
  const unloadVideoModel = useUnloadVideoModel();

  const [open, setOpen] = useState(false);

  const isCloud = activeModel?.source === "cloud";
  const isLocalImage = activeModel?.source === "local";
  const isLocalVideo = activeModel?.source === "local-video";
  const isFramePackActive = isLocalVideo && activeModel.kind === "framepack";

  const showLocalImage = activeNavView !== "video";
  const showCloudImage = activeNavView === "images";
  const showLocalVideo = activeNavView === "video";
  const showCloudVideo = activeNavView === "video";

  const configured = options?.["sd_model_checkpoint"] as string | undefined;
  const configuredName = models?.find((m) => m.title === configured)?.model_name ?? configured;

  // The selection. For local image models useModelSync keeps it on the loaded
  // checkpoint, so it differs only after a pick that has not been loaded yet.
  const displayName = isCloud
    ? (activeModel.name ?? "Cloud model")
    : isLocalVideo
      ? activeModel.name
      : isLocalImage
        ? activeModel.model_name
        : (configuredName ?? "No model selected");

  // Whether the selected model is the one the backend currently has loaded.
  // Drives the merged Load/Reload control: matched -> reload it, mismatched ->
  // load the selection. Local image compares against the loaded checkpoint;
  // local video carries its own loaded flag. A local pick counts as loaded
  // until the server first reports its model, so a page load does not flash Load.
  const selectedIsLoaded =
    activeModel?.source === "local"
      ? checkpoint === undefined || (!!checkpoint.loaded && checkpoint.title === activeModel.title)
      : activeModel?.source === "local-video"
        ? activeModel.loaded
        : false;

  // A local pick that is not loaded waits for Load, or for Generate to load it
  const pendingLoad = (isLocalImage || isLocalVideo) && !selectedIsLoaded;
  const pendingHint =
    "Not loaded yet. It loads when you generate, or now with Load." +
    (!isLocalImage
      ? ""
      : checkpoint?.loaded
        ? ` The server has ${checkpoint.name ?? checkpoint.title ?? "another model"} loaded.`
        : " The server has no model loaded.");

  function handleSelectLocal(model: NonNullable<typeof models>[number]) {
    setOpen(false);
    const localModel: LocalModel = { ...model, source: "local" };
    setActiveModel(localModel);
    toast.success("Model selected", { description: model.model_name });
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

  // Group local video models by engine plus registry group path (LTX
  // families), preserving registry order. One CommandGroup per heading.
  const localVideoGroups = useMemo(() => {
    const groups: { heading: string; models: LocalVideoModel[] }[] = [];
    const index = new Map<string, number>();
    for (const m of localVideoModels) {
      const heading = [m.engine, ...m.group_path].join(" · ");
      let i = index.get(heading);
      if (i === undefined) {
        i = groups.length;
        index.set(heading, i);
        groups.push({ heading, models: [] });
      }
      groups[i]?.models.push(m);
    }
    return groups;
  }, [localVideoModels]);

  // --- Action row dispatch -------------------------------------------------

  // Single Load/Reload control. When the selected model is already the loaded
  // one, re-pull it from disk via sdnext's dedicated reload endpoint; when a
  // different model is selected, load that one instead. Cloud is a no-op
  // (selection is the configuration). Local video has no separate reload
  // route, so re-firing its load both loads and reloads; FramePack uses its
  // dedicated endpoint with the current fpAttention from videoStore.
  function handleLoadOrReload() {
    if (!activeModel) return;
    if (activeModel.source === "local") {
      if (selectedIsLoaded) {
        reloadModel.mutate(undefined);
      } else {
        loadModel.mutate(activeModel.title);
      }
    } else if (activeModel.source === "local-video") {
      if (activeModel.kind === "framepack") {
        const attention = useVideoStore.getState().fpAttention;
        loadFramePack.mutate({ variant: activeModel.model, attention });
      } else {
        loadVideoModel.mutate({ engine: activeModel.engine, model: activeModel.model });
      }
    }
  }

  // Unload: sdnext has /options unload; FramePack has /framepack/unload;
  // every other video engine goes through /sdapi/v2/video/unload.
  function handleUnload() {
    if (!activeModel) return;
    if (activeModel.source === "local") {
      unloadModel.mutate(undefined);
    } else if (isFramePackActive) {
      unloadFramePack.mutate();
    } else if (activeModel.source === "local-video") {
      unloadVideoModel.mutate();
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
  const canUnload = isLocalImage || isLocalVideo;
  const anyVideoMutationPending =
    loadVideoModel.isPending ||
    loadFramePack.isPending ||
    unloadFramePack.isPending ||
    unloadVideoModel.isPending;
  const anyLoadActionPending = isModelLoading || anyVideoMutationPending;
  // A load from this page or from Generate; unload and list refresh share the mutation key
  const loadingModel =
    loadingTarget !== null ||
    reloadModel.isPending ||
    loadVideoModel.isPending ||
    loadFramePack.isPending;

  return (
    <div className="flex min-w-0 items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            disabled={isModelLoading}
            title={displayName}
            // One width for every model, so the controls beside it stay put
            className={cn(
              "w-[26rem] min-w-0 shrink justify-between text-xs h-7 px-2",
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
                      key={model.title}
                      // The title includes the hash, so a hash from image metadata finds its model
                      value={model.title}
                      onSelect={() => handleSelectLocal(model)}
                      className={cn(
                        "text-xs",
                        isLocalImage &&
                          activeModel.title === model.title &&
                          "font-semibold !text-primary",
                      )}
                    >
                      <span className="truncate flex-1">{model.model_name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* Local video models, grouped by engine plus registry group
                  path. Wan/Hunyuan/LTX come from /sdapi/v2/video/engines
                  with caps joined; FramePack variants come from
                  /sdapi/v2/framepack/variants as bare strings. */}
              {showLocalVideo &&
                localVideoGroups.map(({ heading, models: groupModels }) => (
                  <CommandGroup key={`lv-${heading}`} heading={heading}>
                    {groupModels.map((m) => (
                      <CommandItem
                        key={m.title}
                        value={`${heading} ${m.name}`}
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
                        <VideoModelBadges model={m} />
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

      {/* Unified action row: always visible. The Load/Reload control and
          Unload mute when they wouldn't do anything (cloud active, or Unload
          on a generic/LTX video model where no unload endpoint exists).
          Refresh stays active everywhere since invalidating list queries is a
          context-free escape hatch. Load/Reload keeps one width in every
          state; amber marks a pick that still has to be loaded. */}
      <Button
        variant="outline"
        size="sm"
        className={cn(
          "h-6 w-[5.5rem] gap-1 px-2 text-2xs",
          (pendingLoad || loadingModel) &&
            "border-amber-400/40 bg-amber-400/10 text-amber-400 hover:bg-amber-400/20 hover:text-amber-300",
        )}
        title={
          loadingModel
            ? "Loading the model"
            : selectedIsLoaded
              ? "Reload current model"
              : pendingLoad
                ? pendingHint
                : "Load selected model"
        }
        disabled={!canLoadOrReload || anyLoadActionPending}
        onClick={handleLoadOrReload}
      >
        {loadingModel ? (
          <>
            <RefreshCw size={12} className="animate-spin" />
            Loading
          </>
        ) : selectedIsLoaded ? (
          <>
            <RotateCw size={12} />
            Reload
          </>
        ) : (
          <>
            <Upload size={12} />
            Load
          </>
        )}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-6 gap-1 px-2 text-2xs"
        title="Unload current model"
        disabled={!canUnload || anyLoadActionPending}
        onClick={handleUnload}
      >
        <ArrowBigDownDash size={12} />
        Unload
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-6 gap-1 px-2 text-2xs"
        title="Refresh model lists"
        onClick={handleRefresh}
      >
        <FolderSync size={12} />
        Refresh
      </Button>
    </div>
  );
}
