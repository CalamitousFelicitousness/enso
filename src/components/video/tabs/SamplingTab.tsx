import { ParametersSection } from "./sampling/ParametersSection";
import { SizeSection } from "./sampling/SizeSection";
import { useVideoTabContext } from "./useVideoTabContext";

export function SamplingTab() {
  const { caps, job } = useVideoTabContext();
  if (!job) return null;
  return (
    <div className="space-y-1">
      <ParametersSection caps={caps} job={job} />
      <SizeSection caps={caps} job={job} />
    </div>
  );
}
