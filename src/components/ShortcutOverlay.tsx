import { useMemo } from "react";
import { Keyboard } from "lucide-react";
import { useRegisterCommand } from "@/lib/commandRegistry";
import { useShortcutStore } from "@/stores/shortcutStore";
import { useUiStore } from "@/stores/uiStore";
import { useShortcut } from "@/hooks/useShortcut";
import { SHORTCUTS, formatShortcut } from "@/lib/shortcuts";
import type { ShortcutCategory } from "@/lib/shortcuts";
import { GESTURES_HEADING, gestureLines } from "@/canvas/navigation/text";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const HEADING = "text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2";
const KEY = "text-xs bg-muted px-1.5 py-0.5 rounded border border-border font-mono";

function Row({ label, keys }: { label: string; keys: string[] }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 px-2 rounded hover:bg-muted/50">
      <span className="text-sm">{label}</span>
      <span className="flex shrink-0 gap-1">
        {keys.map((k) => (
          <kbd key={k} className={KEY}>
            {k}
          </kbd>
        ))}
      </span>
    </div>
  );
}

export function ShortcutOverlay() {
  const open = useShortcutStore((s) => s.cheatsheetOpen);
  const setOpen = useShortcutStore((s) => s.setCheatsheetOpen);
  const wheel = useUiStore((s) => s.canvasWheel);

  useShortcut("cheatsheet", () => setOpen(!open));
  useRegisterCommand({
    id: "help:shortcuts",
    label: "Keyboard shortcuts",
    group: "Help",
    keywords: ["cheat sheet", "keys", "hotkeys", "help", "gestures"],
    icon: Keyboard,
    shortcutId: "cheatsheet",
    run: () => setOpen(true),
  });

  // One row per label, with every key that does it (Zoom in: + and =)
  const grouped = useMemo(() => {
    const map = new Map<ShortcutCategory, Map<string, string[]>>();
    for (const def of Object.values(SHORTCUTS)) {
      const rows = map.get(def.category) ?? new Map<string, string[]>();
      map.set(def.category, rows);
      const keys = rows.get(def.label) ?? [];
      const key = formatShortcut(def);
      if (!keys.includes(key)) keys.push(key);
      rows.set(def.label, keys);
    }
    return map;
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>Press ? to toggle this overlay</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 mt-2">
          {[...grouped.entries()].map(([category, rows]) => (
            <div key={category}>
              <h3 className={HEADING}>{category}</h3>
              <div className="flex flex-col gap-1">
                {[...rows.entries()].map(([label, keys]) => (
                  <Row key={label} label={label} keys={keys} />
                ))}
              </div>
              {category === "Canvas" && (
                <>
                  <h3 className={`${HEADING} mt-4`}>{GESTURES_HEADING}</h3>
                  <div className="flex flex-col gap-1">
                    {gestureLines(wheel).map((line) => (
                      <Row key={line.gesture} label={line.action} keys={[line.gesture]} />
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
