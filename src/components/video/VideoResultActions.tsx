import { useState } from "react";
import {
  MoreVertical,
  ImagePlus,
  Scissors,
  ArrowUpFromLine,
  RotateCcw,
  FastForward,
  GitCompare,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { FramePickerDialog } from "./FramePickerDialog";
import { ParamDiffDialog } from "./ParamDiffDialog";
import {
  extendFrom,
  reuseSettings,
  sendCapturedFrameToInit,
  sendFirstFrameToInit,
  sendFrameToUpscaleFrom,
  sendLastFrameToInit,
  sendLastFrameToLast,
} from "@/lib/video/resultActions";
import { resolveImageSrc } from "@/lib/utils";
import { isStillResult } from "@/lib/video/results";
import { useActiveVideoCaps } from "@/hooks/useActiveVideoCaps";
import type { VideoResult } from "@/api/types/video";

interface VideoResultActionsProps {
  result: VideoResult;
}

export function VideoResultActions({ result }: VideoResultActionsProps) {
  const [framePickerOpen, setFramePickerOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const videoSrc = resolveImageSrc(result.videoUrl);
  const still = isStillResult(result);
  const caps = useActiveVideoCaps();
  const lastSlotAvailable = caps.last_image !== "ignored";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="icon-sm">
            <MoreVertical size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!still && (
            <>
              <DropdownMenuItem onClick={() => void sendFirstFrameToInit(result)}>
                <ImagePlus size={14} />
                <span>Send first frame to Init</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void sendLastFrameToInit(result)}>
                <ImagePlus size={14} />
                <span>Send last frame to Init</span>
              </DropdownMenuItem>
              {lastSlotAvailable && (
                <DropdownMenuItem onClick={() => void sendLastFrameToLast(result)}>
                  <ImagePlus size={14} />
                  <span>Send last frame to Last</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setFramePickerOpen(true)}>
                <Scissors size={14} />
                <span>Extract frame...</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onClick={() => void sendFrameToUpscaleFrom(result)}>
            <ArrowUpFromLine size={14} />
            <span>Send frame to Upscale</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => reuseSettings(result)}>
            <RotateCcw size={14} />
            <span>Reuse Settings</span>
          </DropdownMenuItem>
          {!still && (
            <DropdownMenuItem onClick={() => void extendFrom(result)}>
              <FastForward size={14} />
              <span>Extend Video</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setDiffOpen(true)}>
            <GitCompare size={14} />
            <span>Compare Settings</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <FramePickerDialog
        videoUrl={videoSrc}
        fps={result.fps}
        open={framePickerOpen}
        onOpenChange={setFramePickerOpen}
        onCapture={sendCapturedFrameToInit}
      />

      <ParamDiffDialog
        open={diffOpen}
        onOpenChange={setDiffOpen}
        resultParams={result.params}
        domain={result.domain}
      />
    </>
  );
}
