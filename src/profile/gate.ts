// The gate's facts as this page sees them: the other tabs counted by the
// inputs lock, the move to the server, the actions sending.

import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { decideGate, type ResetGate } from "@/lib/profile/gate";
import { otherTabs } from "@/inputs/db";
import { useMigration } from "@/inputs/migrate";
import { useSubmitProgress } from "@/inputs/progress";

const POLL_MS = 1_000;

async function countTabs(): Promise<number | null> {
  try {
    return await otherTabs();
  } catch (err) {
    console.warn("[profile] other tabs could not be counted", err);
    return null;
  }
}

/** The gate now, for the request itself. */
export async function resetGate(): Promise<ResetGate> {
  return decideGate({
    tabs: await countTabs(),
    moving: useMigration.getState().controller !== null,
    actions: Object.keys(useSubmitProgress.getState().byAction),
  });
}

/** The gate while `active`, with the tabs counted every second; null until
 * the first count lands. */
export function useResetGate(active: boolean): ResetGate | null {
  const moving = useMigration((s) => s.controller !== null);
  const actions = useSubmitProgress(useShallow((s) => Object.keys(s.byAction)));
  const [tabs, setTabs] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    if (!active) return;
    let live = true;
    const poll = () =>
      void countTabs().then((n) => {
        if (live) setTabs(n);
      });
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
      setTabs(undefined);
    };
  }, [active]);

  if (!active || tabs === undefined) return null;
  return decideGate({ tabs, moving, actions });
}
