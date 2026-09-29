import { useCallback, useMemo } from "react";
import {
  Upload,
  X,
  Download,
  Loader2,
  GitCompareArrows,
  Maximize2,
  FolderInput,
  Plus,
} from "lucide-react";
import { useProcessStore } from "@/stores/processStore";
import { useComparisonStore } from "@/stores/comparisonStore";
import { useJobQueueStore, selectProcessActive } from "@/stores/jobStore";
import { useDropTarget } from "@/hooks/useDropTarget";
import { useWindowPaste } from "@/hooks/useWindowPaste";
import { payloadToFile } from "@/lib/sendTo";
import type { DragPayload } from "@/stores/dragStore";
import { Button } from "@/components/ui/button";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { SwipeMode } from "@/components/comparison/SwipeMode";
import { VideoPlayer } from "@/components/video/VideoPlayer";
import { useKeepAliveVisible } from "@/components/ui/keep-alive";

const isVideoFile = (file: File) => file.type.startsWith("video/");
const isImageFile = (file: File) => file.type.startsWith("image/");

export function ProcessView() {
  const mode = useProcessStore((s) => s.mode);
  const previewUrls = useProcessStore((s) => s.previewUrls);
  const videoPreviewUrl = useProcessStore((s) => s.videoPreviewUrl);
  const inputDir = useProcessStore((s) => s.inputDir);
  const outputDir = useProcessStore((s) => s.outputDir);
  const results = useProcessStore((s) => s.results);
  const resultVideo = useProcessStore((s) => s.resultVideo);
  const resultInfo = useProcessStore((s) => s.resultInfo);
  const selectedResult = useProcessStore((s) => s.selectedResult);
  const compareMode = useProcessStore((s) => s.compareMode);
  const setFiles = useProcessStore((s) => s.setFiles);
  const addFiles = useProcessStore((s) => s.addFiles);
  const removeFile = useProcessStore((s) => s.removeFile);
  const setVideoFile = useProcessStore((s) => s.setVideoFile);
  const setSelectedResult = useProcessStore((s) => s.setSelectedResult);
  const setCompareMode = useProcessStore((s) => s.setCompareMode);
  const isActive = useJobQueueStore(selectProcessActive);

  const takeFiles = useCallback(
    (files: File[]) => {
      if (mode === "video") {
        const video = files.find(isVideoFile);
        if (video) setVideoFile(video);
        return;
      }
      const images = files.filter(isImageFile);
      if (images.length === 0) return;
      if (mode === "batch") addFiles(images);
      else if (images[0]) setFiles([images[0]]);
    },
    [mode, addFiles, setFiles, setVideoFile],
  );

  const { isOver, ...dropHandlers } = useDropTarget({
    onDropPayload: useCallback(
      (payload: DragPayload) => {
        payloadToFile(payload)
          .then((f: File) => takeFiles([f]))
          .catch(() => {});
      },
      [takeFiles],
    ),
    onFilesDrop: takeFiles,
    acceptFile: mode === "video" ? isVideoFile : isImageFile,
  });

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      takeFiles(Array.from(e.target.files ?? []));
      e.target.value = "";
    },
    [takeFiles],
  );

  useWindowPaste(takeFiles, useKeepAliveVisible() && mode !== "folder");

  const result = results[selectedResult] ?? results[0];
  // an input aligns with a result only when the run kept the pairing
  const inputForResult =
    mode === "image" ? previewUrls[0] : mode === "batch" ? previewUrls[selectedResult] : undefined;
  const canCompare = !!result && !!inputForResult;

  const handleFullscreen = useCallback(() => {
    if (!result || !inputForResult) return;
    useComparisonStore
      .getState()
      .openComparison(
        { src: inputForResult, label: "Original" },
        { src: result.url, label: "Processed" },
      );
  }, [result, inputForResult]);

  const dropPrompt = useMemo(() => {
    if (mode === "video") return { title: "Drop a video here", accept: "video/*", multiple: false };
    if (mode === "batch") return { title: "Drop images here", accept: "image/*", multiple: true };
    return { title: "Drop an image here", accept: "image/*", multiple: false };
  }, [mode]);

  if (compareMode && canCompare && result && inputForResult) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border flex-shrink-0">
          <Button variant="secondary" size="sm" onClick={() => setCompareMode(false)}>
            Exit Compare
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleFullscreen}
            title="Fullscreen comparison"
          >
            <Maximize2 size={14} />
          </Button>
        </div>
        <div className="flex-1 min-h-0">
          <SwipeMode
            imageA={{ src: inputForResult, label: "Original" }}
            imageB={{ src: result.url, label: "Processed" }}
          />
        </div>
      </div>
    );
  }

  const hasInput =
    mode === "video" ? !!videoPreviewUrl : mode === "folder" ? true : previewUrls.length > 0;

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      <ResizablePanel defaultSize={50} minSize={30}>
        <div
          className={`relative h-full group${isOver ? " ring-2 ring-primary ring-inset" : ""}`}
          {...dropHandlers}
        >
          {mode === "folder" ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground px-6 text-center">
              <FolderInput size={40} className="opacity-40" />
              <p className="text-sm font-medium">
                {inputDir.trim() ? inputDir.trim() : "Enter a folder on the server in the panel"}
              </p>
              <p className="text-xs opacity-60">
                {outputDir.trim()
                  ? `Results are written to ${outputDir.trim()}`
                  : "Results are written to the extras output folder"}
              </p>
            </div>
          ) : !hasInput ? (
            <label className="flex flex-col items-center justify-center h-full cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
              <Upload size={48} className="mb-3 opacity-40" />
              <p className="text-sm font-medium">{dropPrompt.title}</p>
              <p className="text-xs mt-1 opacity-60">
                or click to browse{mode === "video" ? "" : ", or paste from clipboard"}
              </p>
              <input
                type="file"
                accept={dropPrompt.accept}
                multiple={dropPrompt.multiple}
                className="hidden"
                onChange={handleFileInput}
              />
            </label>
          ) : mode === "video" ? (
            <>
              <video
                src={videoPreviewUrl ?? undefined}
                controls
                muted
                className="w-full h-full object-contain bg-black"
              />
              <Button
                variant="destructive"
                size="icon-sm"
                className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => setVideoFile(null)}
              >
                <X size={14} />
              </Button>
            </>
          ) : mode === "batch" ? (
            <div className="h-full overflow-y-auto p-3">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
                {previewUrls.map((url, i) => (
                  <div
                    key={url}
                    className={`relative aspect-square rounded overflow-hidden bg-muted/30 group/tile${i === selectedResult && results.length > 0 ? " ring-2 ring-primary" : ""}`}
                  >
                    <img src={url} alt="" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      className="absolute top-1 right-1 rounded bg-background/80 p-0.5 opacity-0 group-hover/tile:opacity-100 transition-opacity"
                      onClick={() => removeFile(i)}
                      title="Remove"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <label className="flex flex-col items-center justify-center aspect-square rounded border border-dashed border-border cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
                  <Plus size={18} />
                  <span className="text-3xs mt-1">Add</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleFileInput}
                  />
                </label>
              </div>
            </div>
          ) : (
            <>
              <img src={previewUrls[0]} alt="Input" className="w-full h-full object-contain" />
              <Button
                variant="destructive"
                size="icon-sm"
                className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => setFiles([])}
              >
                <X size={14} />
              </Button>
            </>
          )}
          {isActive && (
            <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
              <Loader2 size={32} className="animate-spin text-primary" />
            </div>
          )}
        </div>
      </ResizablePanel>

      <ResizableHandle />

      <ResizablePanel defaultSize={50} minSize={30}>
        <div className="h-full flex flex-col">
          <div className="flex-1 min-h-0 flex items-center justify-center">
            {resultVideo ? (
              <div className="relative h-full w-full">
                <VideoPlayer src={resultVideo.url} />
              </div>
            ) : result ? (
              <div className="relative h-full w-full group">
                <img src={result.url} alt="Result" className="w-full h-full object-contain" />
                <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                  {canCompare && (
                    <Button variant="secondary" size="sm" onClick={() => setCompareMode(true)}>
                      <GitCompareArrows size={14} />
                      Compare
                    </Button>
                  )}
                  {result.width > 0 && result.height > 0 && (
                    <span className="text-xs bg-background/80 px-2 py-1 rounded text-foreground font-mono tabular-nums">
                      {result.width} x {result.height}
                    </span>
                  )}
                  <a href={result.url} download className="inline-flex">
                    <Button variant="secondary" size="icon-sm">
                      <Download size={14} />
                    </Button>
                  </a>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground opacity-50">Result will appear here</p>
            )}
          </div>
          {results.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto px-3 py-2 border-t border-border flex-shrink-0">
              {results.map((r, i) => (
                <button
                  key={r.url}
                  type="button"
                  className={`flex-shrink-0 size-14 rounded overflow-hidden bg-muted/30${i === selectedResult ? " ring-2 ring-primary" : " opacity-70 hover:opacity-100"}`}
                  onClick={() => setSelectedResult(i)}
                >
                  <img src={r.url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
          {resultInfo && (
            <p
              className="px-3 py-1.5 border-t border-border text-3xs text-muted-foreground font-mono truncate flex-shrink-0"
              title={resultInfo}
            >
              {resultInfo}
            </p>
          )}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
