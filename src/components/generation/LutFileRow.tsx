import { useRef } from "react";
import { Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pickLut, removeLut } from "@/inputs/luts";
import type { LutPlace, LutState } from "@/lib/lut";
import { CHOOSE_CUBE, lutLineText, lutSummaryText } from "@/lib/media/text";
import { cn } from "@/lib/utils";
import { ParamLabel } from "./ParamLabel";

/** A color LUT's file row, and the line under it that says why the LUT is
 * not ready, kept even when empty so the slider below never moves. */
export function LutFileRow({
  where,
  state,
  tooltip,
}: {
  where: LutPlace;
  state: LutState;
  tooltip: string | undefined;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const choose = () => inputRef.current?.click();
  return (
    <>
      <div className="flex items-center gap-2">
        <ParamLabel className="text-2xs text-muted-foreground w-16 flex-shrink-0" tooltip={tooltip}>
          File
        </ParamLabel>
        {state.kind === "none" ? (
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-2xs gap-1.5 flex-1"
            onClick={choose}
          >
            <Upload size={12} />
            {CHOOSE_CUBE}
          </Button>
        ) : (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <span
              className={cn(
                "text-2xs truncate flex-1",
                state.kind === "pickAgain" && "text-destructive",
              )}
              title={state.name}
            >
              {state.name}
            </span>
            <Button variant="ghost" size="icon-sm" onClick={choose} title={CHOOSE_CUBE}>
              <Upload size={12} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => removeLut(where)}
              title="Remove LUT"
            >
              <X size={12} />
            </Button>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".cube"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) pickLut(where, file);
          }}
        />
      </div>
      <p
        role="status"
        className={cn(
          "h-4 truncate text-3xs",
          state.kind === "pickAgain" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {lutLineText(state) ?? ""}
      </p>
    </>
  );
}

/** A LUT section's header summary, so a collapsed section still says its LUT;
 * passed only while there is one, since the header draws its separator for any summary. */
export function LutSummary({ state }: { state: LutState }) {
  const text = lutSummaryText(state);
  if (!text) return null;
  return (
    <span
      className={cn(
        "truncate text-3xs normal-case tracking-normal",
        state.kind === "pickAgain" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {text}
    </span>
  );
}
