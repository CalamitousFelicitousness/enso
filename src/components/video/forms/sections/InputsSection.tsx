import { ArrowLeft, ArrowRight, Music, X } from "lucide-react";
import { SectionLeader } from "@/components/ui/section-leader";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { Button } from "@/components/ui/button";
import { useVideoCanvasStore } from "@/stores/videoCanvasStore";
import { referenceAddresses } from "@/lib/video/referenceMedia";
import { useWireParam } from "./useWireParam";
import type { VideoModelCaps } from "@/api/types/video";
import type { VideoJobType } from "@/lib/video/paramRegistry";

interface SectionProps {
  caps: VideoModelCaps;
  job: VideoJobType;
}

const STRENGTH_HELP =
  "How much the input image constrains the clip.<br>Most engines read it as a denoising strength: low values hold the opening frame close to the input, high values keep only the broad composition and redraw the rest.<br>LTX instead carries it as the weight on every conditioning frame, where higher pins the clip harder to them.<br><br>Only applies when an init image is on the canvas.";

// Ordered reference list; the prompt addresses each entry by its
// per-modality number (<Picture N> / <Video N> / <Audio N>), so reordering
// changes meaning, not looks.
function ReferenceList({ caps }: { caps: VideoModelCaps }) {
  const references = useVideoCanvasStore((s) => s.references);
  const reorderReference = useVideoCanvasStore((s) => s.reorderReference);
  const removeReference = useVideoCanvasStore((s) => s.removeReference);
  if (references.length === 0) return null;
  const addresses = referenceAddresses(references);
  const maxTotal = caps.references.max_total || caps.references.max_images;
  return (
    <div className="space-y-1">
      {references.map((r, i) => (
        <div key={r.id} className="flex items-center gap-1.5">
          <span className="text-3xs font-mono text-muted-foreground shrink-0">
            {addresses[i]?.address}
          </span>
          {r.kind === "audio" ? (
            <span className="w-9 h-6 rounded border border-border grid place-items-center shrink-0">
              <Music size={12} className="text-muted-foreground" />
            </span>
          ) : (
            <img
              src={r.kind === "video" ? (r.posterUrl ?? undefined) : r.objectUrl}
              alt=""
              className="w-9 h-6 rounded border border-border object-cover shrink-0"
            />
          )}
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
      {maxTotal > 0 && references.length > maxTotal && (
        <p className="text-3xs text-amber-500">Only the first {maxTotal} references are sent</p>
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
            caps.init_strength_applicable ? STRENGTH_HELP : "This model does not use input strength"
          }
          keywords={["denoise", "init strength", "condition strength", "i2v", "image to video"]}
        />
      )}
      {showReferences && <ReferenceList caps={caps} />}
    </SectionLeader>
  );
}
