import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, Maximize, Minimize, SkipBack, SkipForward } from "lucide-react";
import { cn } from "@/lib/utils";

const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

interface VideoCompareProps {
  leftSrc: string;
  rightSrc: string;
  leftLabel?: string;
  rightLabel?: string;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function VideoCompare({
  leftSrc,
  rightSrc,
  leftLabel = "A",
  rightLabel = "B",
}: VideoCompareProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLVideoElement>(null);
  const rightRef = useRef<HTMLVideoElement>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const syncingRef = useRef(false);

  const bothVideos = useCallback(() => [leftRef.current, rightRef.current].filter(Boolean), []);

  const togglePlay = useCallback(() => {
    const videos = bothVideos();
    if (videos.length === 0) return;
    if (videos[0].paused) {
      videos.forEach((v) => void v.play());
    } else {
      videos.forEach((v) => v.pause());
    }
  }, [bothVideos]);

  const seek = useCallback(
    (time: number) => {
      bothVideos().forEach((v) => {
        v.currentTime = Math.max(0, Math.min(time, v.duration || 0));
      });
    },
    [bothVideos],
  );

  const stepFrame = useCallback(
    (delta: number) => {
      bothVideos().forEach((v) => {
        v.pause();
        v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta / 24));
      });
    },
    [bothVideos],
  );

  const setPlaybackSpeed = useCallback(
    (s: number) => {
      setSpeed(s);
      bothVideos().forEach((v) => {
        v.playbackRate = s;
      });
    },
    [bothVideos],
  );

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void containerRef.current?.requestFullscreen();
  }, []);

  // Sync right video to left's timeupdate
  useEffect(() => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) return;

    const onTimeUpdate = () => {
      setCurrentTime(left.currentTime);
      if (!syncingRef.current && Math.abs(left.currentTime - right.currentTime) > 0.1) {
        syncingRef.current = true;
        right.currentTime = left.currentTime;
        syncingRef.current = false;
      }
    };
    const onMeta = () => setDuration(left.duration);
    const onPlay = () => {
      setPlaying(true);
      void right.play();
    };
    const onPause = () => {
      setPlaying(false);
      right.pause();
    };

    left.addEventListener("timeupdate", onTimeUpdate);
    left.addEventListener("loadedmetadata", onMeta);
    left.addEventListener("play", onPlay);
    left.addEventListener("pause", onPause);
    return () => {
      left.removeEventListener("timeupdate", onTimeUpdate);
      left.removeEventListener("loadedmetadata", onMeta);
      left.removeEventListener("play", onPlay);
      left.removeEventListener("pause", onPause);
    };
  }, [leftSrc, rightSrc]);

  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  // Keyboard
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          stepFrame(-1);
          break;
        case "ArrowRight":
          e.preventDefault();
          stepFrame(1);
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        case "[": {
          const idx = SPEEDS.indexOf(speed as (typeof SPEEDS)[number]);
          if (idx > 0) setPlaybackSpeed(SPEEDS[idx - 1]);
          break;
        }
        case "]": {
          const idx = SPEEDS.indexOf(speed as (typeof SPEEDS)[number]);
          if (idx < SPEEDS.length - 1) setPlaybackSpeed(SPEEDS[idx + 1]);
          break;
        }
        default:
          break;
      }
    };
    container.addEventListener("keydown", handleKey);
    return () => container.removeEventListener("keydown", handleKey);
  }, [speed, togglePlay, stepFrame, setPlaybackSpeed, toggleFullscreen]);

  const progressFraction = duration > 0 ? currentTime / duration : 0;

  return (
    <div
      ref={containerRef}
      className="relative h-full flex flex-col outline-none"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- container receives keyboard shortcuts (space/F)
      tabIndex={0}
    >
      {/* Videos side by side */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 relative">
          <video ref={leftRef} src={leftSrc} loop muted className="w-full h-full object-contain" />

          <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/60 text-white text-3xs">
            {leftLabel}
          </div>
        </div>
        <div className="w-px bg-border flex-shrink-0" />
        <div className="flex-1 relative">
          <video
            ref={rightRef}
            src={rightSrc}
            loop
            muted
            className="w-full h-full object-contain"
          />

          <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/60 text-white text-3xs">
            {rightLabel}
          </div>
        </div>
      </div>

      {/* Shared control bar */}
      <div className="flex-shrink-0 bg-black/70 backdrop-blur-sm px-3 py-2 flex flex-col gap-1.5">
        {/* Scrub bar */}
        <div
          role="slider"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={currentTime}
          aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
          aria-label="Comparison playback position"
          tabIndex={0}
          className="relative h-4 flex items-center cursor-pointer group outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] rounded-sm"
          onMouseDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            seek(frac * duration);
          }}
          onKeyDown={(e) => {
            if (duration <= 0) return;
            const step = e.shiftKey ? 10 : 5;
            switch (e.key) {
              case "ArrowLeft":
              case "ArrowDown":
                e.preventDefault();
                seek(Math.max(0, currentTime - step));
                break;
              case "ArrowRight":
              case "ArrowUp":
                e.preventDefault();
                seek(Math.min(duration, currentTime + step));
                break;
              case "Home":
                e.preventDefault();
                seek(0);
                break;
              case "End":
                e.preventDefault();
                seek(duration);
                break;
            }
          }}
        >
          <div className="absolute inset-x-0 h-1 bg-white/20 rounded-full">
            <div
              className="absolute inset-y-0 left-0 bg-primary rounded-full"
              style={{ width: `${progressFraction * 100}%` }}
            />
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 text-white text-xs">
          <button onClick={() => stepFrame(-1)} className="hover:text-primary transition-colors">
            <SkipBack size={14} />
          </button>
          <button onClick={togglePlay} className="hover:text-primary transition-colors">
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button onClick={() => stepFrame(1)} className="hover:text-primary transition-colors">
            <SkipForward size={14} />
          </button>
          <span className="font-mono tabular-nums text-white/80 text-3xs">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <div className="flex-1" />
          <button
            onClick={() => {
              const idx = SPEEDS.indexOf(speed as (typeof SPEEDS)[number]);
              setPlaybackSpeed(SPEEDS[(idx + 1) % SPEEDS.length]);
            }}
            className={cn(
              "font-mono tabular-nums text-3xs px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 transition-colors",
            )}
          >
            {speed}x
          </button>
          <button onClick={toggleFullscreen} className="hover:text-primary transition-colors">
            {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}
