// What a move left in this browser, each with why: an entry by its name,
// job records grouped by the reason they stayed. Each can be deleted from
// this browser, asked first, since nothing else holds it.

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { ActionSlot } from "@/components/ui/action-slot";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteFromBrowser, useMigration } from "@/inputs/migrate";
import type { MoveItem } from "@/lib/media/migration";
import {
  DELETE_FROM_BROWSER,
  deleteFromBrowserText,
  skipText,
  stayedRecordsText,
} from "@/lib/media/text";

interface Stayed {
  key: string;
  title: string;
  reason: string;
  items: MoveItem[];
}

function stayedOf(skips: ReturnType<typeof useMigration.getState>["skipped"]): Stayed[] {
  const rows: Stayed[] = [];
  const records = new Map<string, MoveItem[]>();
  for (const [key, skip] of skips) {
    if (skip.item.kind === "entry") {
      rows.push({
        key,
        title: `"${skip.item.entry.name}"`,
        reason: skipText(skip.reason),
        items: [skip.item],
      });
    } else {
      const reason = skipText(skip.reason);
      records.set(reason, [...(records.get(reason) ?? []), skip.item]);
    }
  }
  for (const [reason, items] of records) {
    rows.push({ key: reason, title: stayedRecordsText(items.length), reason, items });
  }
  return rows;
}

export function StayedList() {
  const skipped = useMigration((s) => s.skipped);
  const [asked, setAsked] = useState<Stayed | null>(null);
  const rows = stayedOf(skipped);
  if (rows.length === 0) return null;
  return (
    <ul className="flex flex-col" aria-label="Not moved">
      {rows.map((row) => (
        <li key={row.key} className="flex items-center gap-2 py-1">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-2xs" title={row.title}>
              {row.title}
            </span>
            <span className="line-clamp-2 text-4xs text-muted-foreground" title={row.reason}>
              {row.reason}
            </span>
          </span>
          <ActionSlot
            label={DELETE_FROM_BROWSER}
            icon={Trash2}
            reason={null}
            onAct={() => setAsked(row)}
          />
        </li>
      ))}
      <ConfirmDialog
        open={asked !== null}
        title={`${DELETE_FROM_BROWSER}?`}
        description={asked ? deleteFromBrowserText(asked.title, asked.items.length > 1) : ""}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (asked) void deleteFromBrowser(asked.items);
          setAsked(null);
        }}
        onCancel={() => setAsked(null)}
      />
    </ul>
  );
}
