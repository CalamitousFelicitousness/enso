import { memo, useCallback, useMemo, useState } from "react";
import { ArrowLeftRight, Columns2, GitCompare, Pin, PinOff, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useRegisterCommand } from "@/lib/commandRegistry";
import { useUiStore } from "@/stores/uiStore";
import { MAX_PINNED } from "@/lib/video/history";
import { useVideoStore, type CompareSlot } from "@/stores/videoStore";
import { ParamDiffDialog } from "./ParamDiffDialog";
import { CompareSlotTile } from "./CompareSlotTile";
import { VideoResultTile } from "./VideoResultTile";
import type { VideoResult } from "@/api/types/video";

const SLOT_HEIGHT = 30;
const PINNED_HEIGHT = 30;

/**
 * The working half of the two strips: the pair under judgement and the takes
 * the user pinned to judge against. Recall lives in the Left Panel footer, so
 * this row deliberately shows only what was chosen.
 */
export const VideoCompareStrip = memo(function VideoCompareStrip() {
  const results = useVideoStore((s) => s.results);
  const compareA = useVideoStore((s) => s.compareA);
  const compareB = useVideoStore((s) => s.compareB);
  const compareOpen = useVideoStore((s) => s.compareOpen);
  const [diffOpen, setDiffOpen] = useState(false);

  const left = useMemo(() => results.find((r) => r.id === compareA) ?? null, [results, compareA]);
  const right = useMemo(() => results.find((r) => r.id === compareB) ?? null, [results, compareB]);
  const pinned = useMemo(() => results.filter((r) => r.pinned), [results]);
  const bothLoaded = left !== null && right !== null;

  const handleSelect = useCallback((result: VideoResult) => {
    useVideoStore.getState().selectResult(result.id);
  }, []);

  const setSlot = useCallback((slot: CompareSlot, id: string | null) => {
    useVideoStore.getState().setCompareSlot(slot, id);
  }, []);

  // Palette entries, scoped to the view: KeepAlive keeps this mounted after
  // the user leaves, and ids are one-per-registry.
  const isVideoView = useUiStore((s) => s.activeNavView === "video");
  useRegisterCommand(
    {
      id: "video:compare-toggle",
      label: "Toggle video comparison",
      group: "Video",
      keywords: ["ab", "a/b", "side by side", "versus"],
      icon: Columns2,
      run: () => {
        const store = useVideoStore.getState();
        if (!store.compareA || !store.compareB) {
          toast.warning("Send two results to compare first");
          return;
        }
        store.setCompareOpen(!store.compareOpen);
      },
    },
    isVideoView,
  );
  useRegisterCommand(
    {
      id: "video:compare-swap",
      label: "Swap compare A and B",
      group: "Video",
      keywords: ["ab", "promote", "incumbent", "challenger"],
      icon: ArrowLeftRight,
      run: () => useVideoStore.getState().swapCompare(),
    },
    isVideoView,
  );
  useRegisterCommand(
    {
      id: "video:compare-clear",
      label: "Clear video comparison",
      group: "Video",
      keywords: ["ab", "reset", "empty"],
      icon: X,
      run: () => useVideoStore.getState().clearCompare(),
    },
    isVideoView,
  );
  useRegisterCommand(
    {
      id: "video:send-selected-to-compare",
      label: "Send selected result to compare",
      group: "Video",
      keywords: ["ab", "challenger", "judge"],
      icon: Columns2,
      run: () => {
        const store = useVideoStore.getState();
        if (store.selectedResultId) store.sendToCompare(store.selectedResultId);
      },
    },
    isVideoView,
  );
  useRegisterCommand(
    {
      id: "video:pin-selected",
      label: "Pin selected result",
      group: "Video",
      keywords: ["keep", "working set", "favourite", "favorite"],
      icon: Pin,
      run: () => {
        const store = useVideoStore.getState();
        if (!store.selectedResultId) return;
        if (!store.togglePin(store.selectedResultId)) {
          toast.warning(`Pin limit reached (${MAX_PINNED})`, {
            description: "Unpin a result to make room.",
          });
        }
      },
    },
    isVideoView,
  );

  const renderPinnedActions = useCallback(
    (result: VideoResult) => (
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions -- bubble firewall; each button owns its own keyboard handling
      <div
        className="absolute right-0 bottom-0 left-0 flex justify-center gap-0.5 bg-gradient-to-t from-black/80 to-transparent px-0.5 pt-2 pb-0.5"
        onClick={(e) => e.stopPropagation()}
      >
        <SlotBtn onClick={() => setSlot("A", result.id)} title="Set as A">
          A
        </SlotBtn>
        <SlotBtn onClick={() => setSlot("B", result.id)} title="Set as B">
          B
        </SlotBtn>
        <SlotBtn
          onClick={() => useVideoStore.getState().togglePin(result.id)}
          title="Unpin"
          icon={<PinOff size={9} />}
        />
      </div>
    ),
    [setSlot],
  );

  return (
    <div className="flex flex-shrink-0 items-center gap-2 border-t border-border bg-muted/30 px-2 py-1.5">
      <div className="flex flex-shrink-0 items-center gap-1">
        <CompareSlotTile
          slot="A"
          result={left}
          height={SLOT_HEIGHT}
          onClear={() => setSlot("A", null)}
        />
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={!compareA && !compareB}
          onClick={() => useVideoStore.getState().swapCompare()}
          title="Swap A and B"
        >
          <ArrowLeftRight size={12} />
        </Button>
        <CompareSlotTile
          slot="B"
          result={right}
          height={SLOT_HEIGHT}
          onClear={() => setSlot("B", null)}
        />
        <Button
          variant={compareOpen ? "default" : "ghost"}
          size="icon-xs"
          disabled={!bothLoaded}
          onClick={() => useVideoStore.getState().setCompareOpen(!compareOpen)}
          title={compareOpen ? "Exit comparison" : "Compare A and B"}
        >
          {compareOpen ? <X size={12} /> : <Columns2 size={12} />}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={!bothLoaded}
          onClick={() => setDiffOpen(true)}
          title="Diff the settings behind A and B"
        >
          <GitCompare size={12} />
        </Button>
      </div>

      <div className="h-6 w-px flex-shrink-0 bg-border" />

      {pinned.length > 0 ? (
        <div className="flex flex-1 items-center gap-1 overflow-x-auto">
          {pinned.map((result) => (
            <VideoResultTile
              key={result.id}
              result={result}
              height={PINNED_HEIGHT}
              slot={result.id === compareA ? "A" : result.id === compareB ? "B" : undefined}
              onSelect={handleSelect}
              actions={renderPinnedActions}
            />
          ))}
        </div>
      ) : (
        <span className="flex-1 truncate text-2xs text-muted-foreground">
          Pin results in the Result Strip to keep them here.
        </span>
      )}

      {diffOpen && bothLoaded && (
        <ParamDiffDialog
          open={diffOpen}
          onOpenChange={setDiffOpen}
          resultParams={right.params}
          domain={right.domain}
          baselineParams={left.params}
          baselineDomain={left.domain}
        />
      )}
    </div>
  );
});

function SlotBtn({
  children,
  icon,
  onClick,
  title,
}: {
  children?: React.ReactNode;
  icon?: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex h-4 min-w-4 items-center justify-center rounded px-1 text-4xs font-bold text-white/80 transition-colors hover:bg-white/20 hover:text-white"
    >
      {icon ?? children}
    </button>
  );
}
