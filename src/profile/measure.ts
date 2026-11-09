// What this browser keeps, counted for the reset's rows once each source has
// read what it stored.

import { useEffect, useState } from "react";
import { isTerminal } from "@/lib/jobs/domains";
import { JOBS, LIBRARY, TRASH } from "@/lib/inputs/storeLayout";
import type { ProfileMeasure } from "@/lib/profile/text";
import { countRecords } from "@/inputs/db";
import { historyHydrated, useGenerationStore } from "@/stores/generationStore";
import { inputsReady, useInputStore } from "@/stores/inputStore";
import { useJobQueueStore } from "@/stores/jobStore";
import { usePresetStore } from "@/stores/presetStore";
import { usePromptHistoryStore } from "@/stores/promptHistoryStore";
import { useVideoCanvasStore } from "@/stores/videoCanvasStore";
import { useVideoPresetStore } from "@/stores/videoPresetStore";
import { useVideoStore } from "@/stores/videoStore";

/** A source whose read failed never says so: past this, it counts what it holds. */
const READ_WAIT_MS = 3_000;

function within(read: Promise<unknown>): Promise<void> {
  return Promise.race([
    read.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => setTimeout(resolve, READ_WAIT_MS)),
  ]);
}

function videoCanvasRead(): Promise<void> {
  const { persist } = useVideoCanvasStore;
  if (persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = persist.onFinishHydration(() => {
      stop();
      resolve();
    });
  });
}

async function storedCounts(): Promise<[number, number, number]> {
  try {
    const [removals = 0, entries = 0, records = 0] = await countRecords([TRASH, LIBRARY, JOBS]);
    return [removals, entries, records];
  } catch (err) {
    console.warn("[profile] the stored inputs could not be counted", err);
    return [0, 0, 0];
  }
}

export async function measureProfile(): Promise<ProfileMeasure> {
  const [[removals, heldEntries, heldRecords]] = await Promise.all([
    storedCounts(),
    within(inputsReady()),
    within(historyHydrated()),
    within(videoCanvasRead()),
  ]);

  const frames = useInputStore.getState().frames.filter((f) => f.pictures.length > 0);
  const video = useVideoCanvasStore.getState();
  const history = usePromptHistoryStore.getState().history;
  const made = (presets: readonly { builtIn?: boolean }[]) =>
    presets.filter((p) => !p.builtIn).length;

  return {
    inputs: frames.length,
    pictures: frames.reduce((n, f) => n + f.pictures.length, 0),
    removals,
    results: useGenerationStore.getState().results.length,
    videoResults: useVideoStore.getState().results.length,
    videoInputs: [video.initFrame, video.lastFrame].filter(Boolean).length,
    videoReferences: video.references.length,
    presets: made(usePresetStore.getState().presets) + made(useVideoPresetStore.getState().presets),
    prompts: history.length,
    pinnedPrompts: history.filter((h) => h.pinned).length,
    heldEntries,
    heldRecords,
    liveJobs: [...useJobQueueStore.getState().jobs.values()].filter((j) => !isTerminal(j.status))
      .length,
  };
}

/** The counts, taken afresh each time `active` turns on; the last ones stand
 * while new ones are taken, null until the first land. */
export function useProfileMeasure(active: boolean): ProfileMeasure | null {
  const [measure, setMeasure] = useState<ProfileMeasure | null>(null);
  useEffect(() => {
    if (!active) return;
    let live = true;
    void measureProfile().then((m) => {
      if (live) setMeasure(m);
    });
    return () => {
      live = false;
    };
  }, [active]);
  return measure;
}
