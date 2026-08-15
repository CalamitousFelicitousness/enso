import { Lock } from "lucide-react";
import type { LocalVideoModel } from "@/api/types/cloud";

// Capability badges for a video model row: mode/workflow chip, audio and
// reference support, and a lock for gated HF repos (the difference between
// "load failed" and "you need to accept the license").
export function VideoModelBadges({ model }: { model: LocalVideoModel }) {
  const caps = model.caps;
  return (
    <span className="flex items-center gap-1 shrink-0 ml-2">
      {model.mode !== "t2v" && (
        <span className="text-4xs font-medium uppercase bg-muted px-1 rounded">
          {model.mode === "workflow" ? (model.workflow ?? model.mode) : model.mode}
        </span>
      )}
      {caps?.audio.produces_audio && (
        <span
          className="text-4xs font-medium uppercase bg-muted px-1 rounded"
          title="Generates an audio track"
        >
          aud
        </span>
      )}
      {caps?.references.supported && (
        <span
          className="text-4xs font-medium uppercase bg-muted px-1 rounded"
          title={`Conditions on up to ${caps.references.max_images} reference images`}
        >
          ref
        </span>
      )}
      {caps?.gated_repo && (
        <span title="Gated HuggingFace repo: requires an accepted license and a configured token">
          <Lock size={10} className="text-muted-foreground" />
        </span>
      )}
    </span>
  );
}
