import { useCallback, useMemo } from "react";
import {
  DEFAULT_SECTIONS,
  useProcessStore,
  type ProcessSectionKey,
  type ProcessSectionParams,
} from "@/stores/processStore";
import { sectionApplies } from "@/lib/processRequest";

type Setter<T> = (value: T) => void;
type Setters<K extends ProcessSectionKey> = {
  [F in keyof ProcessSectionParams[K]]: Setter<ProcessSectionParams[K][F]>;
};

/** One section's slice of the process store with a stable setter per field. */
export function useProcessSection<K extends ProcessSectionKey>(key: K) {
  const enabled = useProcessStore((s) => s.sections[key].enabled);
  const params = useProcessStore((s) => s.sections[key].params);
  const mode = useProcessStore((s) => s.mode);
  const setSectionEnabled = useProcessStore((s) => s.setSectionEnabled);
  const setSectionParam = useProcessStore((s) => s.setSectionParam);

  const setEnabled = useCallback(
    (v: boolean) => setSectionEnabled(key, v),
    [key, setSectionEnabled],
  );

  // Built once per section from the canonical field list, so every setter
  // keeps its identity across renders and memoized controls stay put.
  const setters = useMemo(() => {
    const fields = Object.keys(DEFAULT_SECTIONS[key].params) as (keyof ProcessSectionParams[K])[];
    const out = {} as Setters<K>;
    for (const field of fields) {
      out[field] = (value: ProcessSectionParams[K][typeof field]) =>
        setSectionParam(key, field, value);
    }
    return out;
  }, [key, setSectionParam]);

  const set = useCallback(
    <F extends keyof ProcessSectionParams[K]>(field: F): Setter<ProcessSectionParams[K][F]> =>
      setters[field],
    [setters],
  );

  return { enabled, params, applies: sectionApplies(key, mode), mode, setEnabled, set };
}
