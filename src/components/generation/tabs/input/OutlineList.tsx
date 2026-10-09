// The frames in list order, one row each. Keys work on the focused row:
// arrows move the selection, Alt+arrows move the frame, Delete removes it,
// Enter shows it on the canvas. Rows are drag-sortable by their number, and
// a library entry dropped on the list joins it at the end.

import { useCallback, useEffect, useRef } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useInputStore } from "@/stores/inputStore";
import { useDropTarget } from "@/hooks/useDropTarget";
import { recallEntry } from "@/inputs/recall";
import type { EntryPayload } from "@/lib/drag";
import { cn } from "@/lib/utils";
import { moveFrame, removeFrame } from "@/inputs/edits";
import { revealFrame } from "@/inputs/reveal";
import type { Outline } from "@/lib/inputs/outline";
import { OutlineRow } from "./OutlineRow";

export function OutlineList({ outline }: { outline: Outline }) {
  const selectedFrameId = useInputStore((s) => s.selectedFrameId);
  const listRef = useRef<HTMLDivElement>(null);
  const focusWanted = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const entries = outline.entries;

  const focusRow = useCallback((frameId: string | null) => {
    if (!frameId) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-frame-id="${frameId}"]`);
    row?.focus();
  }, []);

  // After a key moved or removed a frame, focus follows the selection
  useEffect(() => {
    if (!focusWanted.current) return;
    focusWanted.current = false;
    focusRow(selectedFrameId);
  }, [selectedFrameId, entries, focusRow]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, frameId: string) => {
      // keys on the switch or the remove button are theirs
      if (e.target !== e.currentTarget) return;
      const index = entries.findIndex((entry) => entry.frameId === frameId);
      if (index < 0) return;
      const to = (next: number) => {
        const entry = entries[Math.max(0, Math.min(entries.length - 1, next))];
        focusWanted.current = true;
        revealFrame(entry.frameId);
      };
      switch (e.key) {
        case "ArrowDown":
        case "ArrowUp": {
          const next = index + (e.key === "ArrowDown" ? 1 : -1);
          if (next < 0 || next >= entries.length) break;
          if (e.altKey) {
            moveFrame(index, next);
            focusWanted.current = true;
          } else {
            to(next);
          }
          break;
        }
        case "Home":
          to(0);
          break;
        case "End":
          to(entries.length - 1);
          break;
        case "Delete":
        case "Backspace":
          focusWanted.current = true;
          removeFrame(frameId);
          break;
        case "Enter":
          revealFrame(frameId);
          break;
        default:
          return;
      }
      e.preventDefault();
    },
    [entries],
  );

  const { isOver, ...dropHandlers } = useDropTarget({
    onDropEntry: useCallback((payload: EntryPayload) => {
      void recallEntry(payload.entryId, "add");
    }, []),
  });

  const handleDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = entries.findIndex((entry) => entry.frameId === e.active.id);
    const over = entries.findIndex((entry) => entry.frameId === e.over?.id);
    if (from < 0 || over < 0) return;
    moveFrame(from, over);
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <SortableContext items={entries.map((e) => e.frameId)} strategy={verticalListSortingStrategy}>
        <div
          ref={listRef}
          role="listbox"
          aria-label="Input frames"
          className={cn(
            "flex max-h-[40vh] flex-col gap-1 overflow-y-auto rounded-md",
            isOver && "ring-2 ring-primary ring-inset",
          )}
          {...dropHandlers}
        >
          {entries.map((entry) => (
            <OutlineRow
              key={entry.frameId}
              entry={entry}
              selected={entry.frameId === selectedFrameId}
              canRemove={entries.length > 1}
              onSelect={revealFrame}
              onKeyDown={handleKeyDown}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
