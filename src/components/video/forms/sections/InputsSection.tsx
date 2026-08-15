import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { SectionLeader } from "@/components/ui/section-leader";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { Button } from "@/components/ui/button";
import { useVideoCanvasStore } from "@/stores/videoCanvasStore";
import { useWireParam } from "./useWireParam";
import type { VideoModelCaps } from "@/api/types/video";
import type { VideoJobType } from "@/lib/video/paramRegistry";

interface SectionProps {
  caps: VideoModelCaps;
  job: VideoJobType;
}

// Ordered reference list; index 0 = <Picture 1> and the prompt addresses
// references by that number, so reordering changes meaning, not looks.
function ReferenceList({ caps }: { caps: VideoModelCaps }) {
  const references = useVideoCanvasStore((s) => s.references);
  const reorderReference = useVideoCanvasStore((s) => s.reorderReference);
  const removeReference = useVideoCanvasStore((s) => s.removeReference);
  if (references.length === 0) return null;
  return (
    <div className="space-y-1">
      {references.map((r, i) => (
        <div key={r.id} className="flex items-center gap-1.5">
          <span className="text-3xs font-mono text-muted-foreground w-14 shrink-0">
            {"<Picture "}
            {i + 1}
            {">"}
          </span>
          <img
            src={r.objectUrl}
            alt=""
            className="w-9 h-6 rounded border border-border object-cover"
          />
          <span className="flex-1" />
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={i === 0}
            onClick={() => reorderReference(i, i - 1)}
            title="Move earlier"
          >
            <ArrowLeft size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={i === references.length - 1}
            onClick={() => reorderReference(i, i + 1)}
            title="Move later"
          >
            <ArrowRight size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => removeReference(r.id)}
            title="Remove"
          >
            <X size={12} />
          </Button>
        </div>
      ))}
      {references.length > caps.references.max_images && (
        <p className="text-3xs text-amber-500">
          Only the first {caps.references.max_images} references are sent
        </p>
      )}
    </div>
  );
}

export function InputsSection({ caps, job }: SectionProps) {
  const initStrength = useWireParam<number>(job, "init_strength");
  const conditionStrength = useWireParam<number>(job, "condition_strength");
  const strength = initStrength.key !== undefined ? initStrength : conditionStrength;

  const hasInputs =
    caps.init_image !== "ignored" || caps.last_image !== "ignored" || caps.references.supported;
  if (!hasInputs) return null;

  const showReferences = caps.references.supported && job === "video";
  const contract = [
    caps.init_image !== "ignored" ? `Init ${caps.init_image}` : null,
    caps.last_image !== "ignored" ? `Last ${caps.last_image}` : null,
    showReferences ? `up to ${caps.references.max_images} references` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <SectionLeader title="Inputs" collapsible defaultCollapsed>
      <p className="text-3xs text-muted-foreground">{contract} - drop images on the canvas</p>
      {strength.key !== undefined && (
        <ParamSlider
          label="Strength"
          value={strength.value ?? 0.5}
          onChange={strength.set}
          min={0}
          max={1}
          step={0.05}
          disabled={!caps.init_strength_applicable}
          tooltip={
            caps.init_strength_applicable ? undefined : "This model does not use input strength"
          }
        />
      )}
      {showReferences && <ReferenceList caps={caps} />}
    </SectionLeader>
  );
}
