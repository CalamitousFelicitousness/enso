import { StagesSection } from "./output/StagesSection";
import { DecodeSection } from "./output/DecodeSection";
import { OutputSection } from "./output/OutputSection";
import { useVideoTabContext } from "./useVideoTabContext";

// Everything after sampling: the optional upsample/refine stages, the decode
// settings, then the container the clip is written to. Each section keeps its
// own wire-presence gate, so a model without those params shows fewer rows
// rather than an empty tab.
export function OutputTab() {
  const { caps, job } = useVideoTabContext();
  if (!job) return null;
  return (
    <div className="space-y-1">
      <StagesSection caps={caps} job={job} />
      <DecodeSection caps={caps} job={job} />
      <OutputSection caps={caps} />
    </div>
  );
}
