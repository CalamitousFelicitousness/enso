import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { useActiveVideoCaps } from "@/hooks/useActiveVideoCaps";
import { resolveVideoUi } from "@/lib/videoModel";
import { jobTypeForKind } from "@/lib/video/buildVideoPayload";
import { VideoPresetSelector } from "../VideoPresetSelector";
import { OutputSection } from "../tabs/output/OutputSection";
import { StylesSection } from "../tabs/prompts/StylesSection";
import { ParametersSection } from "../tabs/sampling/ParametersSection";
import { SizeSection } from "../tabs/sampling/SizeSection";
import { InputsSection } from "../tabs/inputs/InputsSection";
import { StagesSection } from "../tabs/output/StagesSection";
import { DecodeSection } from "../tabs/output/DecodeSection";
import { FramePackSection } from "../tabs/framepack/FramePackSection";

// One form for every local video engine: sections gate and parameterize
// (bounds, defaults, visibility, disabled state) from the active model's
// capability descriptor instead of per-engine component trees. Controls that
// exist on the wire but do not apply to the model render disabled with an
// explanatory tooltip; whole subsystems the model lacks are removed.
export function CapabilityForm() {
  const activeModel = useModelSelectionStore((s) => s.activeModel);
  const caps = useActiveVideoCaps();
  const kind = resolveVideoUi(activeModel);
  if (kind === "cloud" || kind === "empty") return null;
  const job = jobTypeForKind(kind);
  const showStages = caps.stages.upsample || caps.stages.refine;

  return (
    <div className="space-y-1">
      <VideoPresetSelector domain={job} />
      <ParametersSection caps={caps} job={job} />
      <SizeSection caps={caps} job={job} />
      <InputsSection caps={caps} job={job} />
      {showStages && <StagesSection caps={caps} job={job} />}
      <DecodeSection caps={caps} job={job} />
      {job === "framepack" && <FramePackSection />}
      <StylesSection />
      <OutputSection caps={caps} />
    </div>
  );
}
