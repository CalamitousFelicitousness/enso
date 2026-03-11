import { useCurrentCheckpoint, useIsModelLoading } from "@/api/hooks/useModels";
import { useMemory, useGpuStatus, useLoadedModels } from "@/api/hooks/useServer";
import { useJobList } from "@/api/hooks/useJobs";
import { useBackendStatusStore } from "@/stores/backendStatusStore";

import { LoadedModelsPanel } from "@/components/layout/LoadedModelsPanel";

// ---------------------------------------------------------------------------
// Inline sub-components
// ---------------------------------------------------------------------------

/** Fixed-width numeric slot — phantom string reserves max width, real value overlays it. */
function MonoSlot({ value, phantom }: { value: string; phantom: string }) {
  return (
    <span className="relative inline-flex font-mono tabular-nums text-3xs">
      <span className="invisible" aria-hidden>{phantom}</span>
      <span className="absolute inset-0 text-right">{value}</span>
    </span>
  );
}

/** 4-digit counter with dimmed leading zeros. */
function GhostCounter({ value, digits = 4 }: { value: number; digits?: number }) {
  const str = String(Math.max(0, value)).padStart(digits, "0");
  const firstSig = str.search(/[^0]/);
  const leadingZeros = firstSig === -1 ? str : str.slice(0, firstSig);
  const significant = firstSig === -1 ? "" : str.slice(firstSig);
  return (
    <span className="font-mono tabular-nums text-3xs">
      {leadingZeros && (
        <span className="text-muted-foreground opacity-20">{leadingZeros}</span>
      )}
      <span className="text-foreground">{significant}</span>
    </span>
  );
}

/** 5-segment GPU utilization gauge. */
function GpuGauge({ percent }: { percent: number }) {
  const filled = Math.round((percent / 100) * 5);
  return (
    <span className="inline-flex items-center gap-[2px]">
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={`w-[5px] h-[8px] rounded-[1px] ${i < filled ? "bg-primary" : "bg-muted"}`}
        />
      ))}
    </span>
  );
}

/** Format bytes as GB pair (always GB, no auto-scaling). */
function formatGbPair(used: number, total: number): { usedNum: string; totalNum: string } {
  const GB = 1024 ** 3;
  const usedNum = parseFloat((used / GB).toFixed(1)).toString();
  const totalNum = parseFloat((total / GB).toFixed(1)).toString();
  return { usedNum, totalNum };
}

/** Inline memory bar with label, value, and 48px progress track. */
function MemBar({ label, used, total }: { label: string; used: number; total: number }) {
  const pct = total > 0 ? (used / total) * 100 : 0;
  const critical = pct >= 90;
  const { usedNum, totalNum } = formatGbPair(used, total);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-3xs text-muted-foreground">{label}</span>
      <MonoSlot value={`${usedNum} / ${totalNum} GB`} phantom="000.0 / 000.0 GB" />
      <span className="w-12 h-[3px] rounded-full bg-muted overflow-hidden">
        <span
          className={`block h-full rounded-full transition-[width] duration-300 ${critical ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </span>
    </span>
  );
}

type DotStatus = "connected" | "loading" | "high-vram" | "disconnected";

const DOT_STYLES: Record<DotStatus, { dot: string; glow: string; animate: boolean }> = {
  connected:    { dot: "bg-emerald-500", glow: "0 0 6px 2px rgba(16,185,129,0.35)",  animate: false },
  loading:      { dot: "bg-amber-500",   glow: "0 0 6px 2px rgba(245,158,11,0.35)",  animate: true },
  "high-vram":  { dot: "bg-amber-500",   glow: "0 0 6px 2px rgba(245,158,11,0.25)",  animate: false },
  disconnected: { dot: "bg-red-500",     glow: "0 0 6px 2px rgba(239,68,68,0.35)",   animate: false },
};

function StatusDot({ status }: { status: DotStatus }) {
  const s = DOT_STYLES[status];
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot} ${s.animate ? "animate-pulse" : ""}`}
      style={{ boxShadow: s.glow }}
    />
  );
}

/** Hairline vertical separator. */
function Sep() {
  return <span className="w-px h-3 bg-border flex-shrink-0" />;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function BottomStatusBar() {
  const { data: checkpoint } = useCurrentCheckpoint();
  const isModelLoading = useIsModelLoading();
  const { data: loadedModels } = useLoadedModels();
  const { data: memory } = useMemory();
  const { data: gpuList } = useGpuStatus();
  const { data: jobList } = useJobList({ status: "completed", type: "generate", limit: 1 });
  const wsConnected = useBackendStatusStore((s) => s.connected);

  // Derived values
  const gpu = gpuList?.[0]?.metrics;
  const gpuPct = gpu?.load_gpu ?? null;
  const gpuTemp = gpu?.temperature ?? null;

  const vramUsed = memory?.cuda?.allocated?.current ?? null;
  const vramTotal = memory?.cuda?.system?.total ?? null;
  const ramUsed = memory?.ram?.used ?? null;
  const ramTotal = memory?.ram?.total ?? null;
  const ramError = memory?.ram?.error;

  const vramPct = vramUsed != null && vramTotal != null && vramTotal > 0
    ? (vramUsed / vramTotal) * 100
    : 0;

  const genCount = jobList?.total ?? 0;

  // Status dot logic
  const status: DotStatus = !wsConnected
    ? "disconnected"
    : isModelLoading
      ? "loading"
      : vramPct >= 90
        ? "high-vram"
        : "connected";

  // Model name
  const modelName = checkpoint?.name ?? null;
  const modelLoaded = checkpoint?.loaded ?? false;

  // Active LoRAs
  const loras = loadedModels?.filter((m) => m.category === "lora").map((m) => m.name) ?? [];

  return (
    <footer className="flex items-center h-6 px-3 gap-2.5 border-t border-border bg-card text-muted-foreground flex-shrink-0">
      {/* Left: status dot + model + loras */}
      <span className="flex items-center gap-1.5 min-w-0">
        <StatusDot status={status} />
        {isModelLoading ? (
          <span className="text-2xs italic text-muted-foreground truncate">Loading model…</span>
        ) : modelName && modelLoaded ? (
          <span className="text-2xs font-medium text-foreground truncate">{modelName}</span>
        ) : (
          <span className="text-2xs text-muted-foreground truncate">No model</span>
        )}
        {loras.length > 0 && !isModelLoading && (
          <>
            <span className="text-3xs text-muted-foreground/50">·</span>
            <span className="text-3xs text-muted-foreground/70 truncate">
              {loras.join(", ")}
            </span>
          </>
        )}
      </span>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: GPU gauge + temp | VRAM bar | RAM bar | gen counter */}
      <span className="flex items-center gap-2.5 flex-shrink-0">
        {gpuPct != null && (
          <>
            <span className="inline-flex items-center gap-1.5">
              <GpuGauge percent={gpuPct} />
              <span className="font-mono tabular-nums text-3xs font-medium text-foreground">
                <MonoSlot value={`${Math.round(gpuPct)}%`} phantom="100%" />
              </span>
              {gpuTemp != null && (
                <span className={`font-mono tabular-nums text-3xs ${gpuTemp >= 80 ? "text-amber-500" : "text-muted-foreground"}`}>
                  <MonoSlot value={`${Math.round(gpuTemp)}°C`} phantom="100°C" />
                </span>
              )}
            </span>
            <Sep />
          </>
        )}

        {vramUsed != null && vramTotal != null && (
          <>
            <LoadedModelsPanel>
              <button
                type="button"
                className="inline-flex items-center hover:text-foreground transition-colors cursor-pointer"
              >
                <MemBar label="VRAM" used={vramUsed} total={vramTotal} />
              </button>
            </LoadedModelsPanel>
            <Sep />
          </>
        )}

        {ramUsed != null && ramTotal != null && !ramError && (
          <>
            <MemBar label="RAM" used={ramUsed} total={ramTotal} />
            <Sep />
          </>
        )}

        <GhostCounter value={genCount} />
      </span>
    </footer>
  );
}
