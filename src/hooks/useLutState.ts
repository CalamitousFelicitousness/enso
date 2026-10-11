import { useEffect, useState } from "react";
import { checkLut } from "@/inputs/luts";
import { lutBytes, lutState, type LutClaim, type LutPlace, type LutState } from "@/lib/lut";
import { useGenerationStore } from "@/stores/generationStore";
import { useLutsHydrated, useLutStore } from "@/stores/lutStore";
import { useProcessLutStore } from "@/stores/processLutStore";

/** What a view's LUT section shows. With a hash and, once the stored bytes are
 * read, none of them here, it asks the server once: held bytes come back, a
 * miss asks for a new pick. */
export function useLutState(where: LutPlace): LutState {
  const imagesName = useGenerationStore((s) => s.gradingLutFile);
  const imagesHash = useGenerationStore((s) => s.gradingLutHash);
  const processName = useProcessLutStore((s) => s.name);
  const processHash = useProcessLutStore((s) => s.hash);
  const name = where === "images" ? imagesName : processName;
  const hash = where === "images" ? imagesHash : processHash;
  const pending = useLutStore((s) => s[where]);
  const hydrated = useLutsHydrated();
  const [checked, setChecked] = useState<{ hash: string; claim: LutClaim } | null>(null);
  const here = lutBytes({ name, hash }, pending) !== null;

  useEffect(() => {
    if (!hydrated || !name || !hash || here) return;
    let live = true;
    void checkLut(where, { name, hash }, (claim) => {
      if (live) setChecked({ hash, claim });
    });
    return () => {
      live = false;
    };
  }, [where, name, hash, here, hydrated]);

  return lutState({ name, hash }, pending, checked?.hash === hash ? checked.claim : "unchecked");
}
