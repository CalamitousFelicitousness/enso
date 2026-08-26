import { InputsSection } from "./inputs/InputsSection";
import { useVideoTabContext } from "./useVideoTabContext";

export function InputsTab() {
  const { caps, job } = useVideoTabContext();
  if (!job) return null;
  return <InputsSection caps={caps} job={job} />;
}
