import { useCallback, useMemo, Fragment } from "react";
import { useScripts } from "@/api/hooks/useScripts";
import { usePostprocessScripts } from "@/api/hooks/usePostprocess";
import { useOptions } from "@/api/hooks/useSettings";
import { hdrState } from "@/lib/processHdr";
import { useScriptStore } from "@/stores/scriptStore";
import { SectionLeader, SectionDivider } from "@/components/ui/section-leader";
import { ScriptArgControl } from "./scripts/ScriptArgControl";
import { ScriptSection } from "./scripts/ScriptSection";
import { ParamLabel } from "@/components/generation/ParamLabel";
import { Combobox } from "@/components/ui/combobox";
import type { ScriptInfoV2 } from "@/api/types/script";

export function ScriptsTab() {
  const { data: scripts } = useScripts();
  const store = useScriptStore();

  const selectableScripts = useMemo(
    () =>
      scripts?.scripts
        .filter((s) => !s.is_alwayson && s.contexts.includes("txt2img"))
        .map((s) => s.name) ?? [],
    [scripts],
  );

  const selectedInfo = useMemo(
    () => scripts?.scripts.find((s) => s.name === store.selectedScript),
    [scripts, store.selectedScript],
  );

  const alwaysOnScripts = useMemo(() => {
    if (!scripts) return [];
    return scripts.scripts.filter((s) => s.is_alwayson && s.args.length > 0);
  }, [scripts]);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <SectionLeader title="Script" collapsible>
        <div className="flex items-center gap-2">
          <ParamLabel className="text-2xs text-muted-foreground w-16 flex-shrink-0">
            Script
          </ParamLabel>
          <Combobox
            value={store.selectedScript || "__none__"}
            onValueChange={(v) => store.setSelectedScript(v === "__none__" ? "" : v)}
            options={[
              { value: "__none__", label: "None" },
              ...selectableScripts.map((name) => ({
                value: name,
                label: name,
              })),
            ]}
            placeholder="None"
            className="h-6 text-2xs flex-1"
          />
        </div>

        {selectedInfo && selectedInfo.args.length > 0 && (
          <div className="flex flex-col gap-2 mt-1">
            {selectedInfo.args.map((arg, i) => (
              <ScriptArgControl
                key={`${store.selectedScript}-${i}`}
                arg={arg}
                value={store.scriptArgs[i] ?? arg.value}
                onChange={(v) => store.setScriptArg(i, v)}
              />
            ))}
          </div>
        )}
      </SectionLeader>

      {alwaysOnScripts.map((script) => (
        <Fragment key={script.name}>
          <SectionDivider />
          <AlwaysOnSection script={script} />
        </Fragment>
      ))}
    </div>
  );
}

function AlwaysOnSection({ script }: { script: ScriptInfoV2 }) {
  const store = useScriptStore();
  const getArgValue = useCallback(
    (index: number) => store.alwaysOnOverrides[script.name]?.[index] ?? script.args[index]?.value,
    [store.alwaysOnOverrides, script.name, script.args],
  );
  const setArgValue = useCallback(
    (index: number, value: unknown) => store.setAlwaysOnArg(script.name, index, value),
    [store, script.name],
  );

  return (
    <SectionLeader title={script.name} collapsible defaultCollapsed>
      <ScriptSection script={script} getArgValue={getArgValue} setArgValue={setArgValue} />
      {script.name === "hdr" && <HdrNote />}
    </SectionLeader>
  );
}

/** What the HDR settings write beside each saved image, or why they write nothing. */
function HdrNote() {
  const { data: scripts } = usePostprocessScripts();
  const { data: options } = useOptions();
  const format = (options as Record<string, unknown> | undefined)?.["samples_format"];
  const state = hdrState(
    scripts?.hdr,
    typeof format === "string" ? format : undefined,
    "image",
    true,
  );
  return (
    <p className="mt-2 min-h-4 text-3xs text-muted-foreground">
      {state.applies ? state.note : state.hint}
    </p>
  );
}
