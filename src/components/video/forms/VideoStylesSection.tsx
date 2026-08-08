import { useVideoStore } from "@/stores/videoStore";
import { usePromptStyles } from "@/api/hooks/useNetworks";
import { SectionLeader } from "@/components/ui/section-leader";
import { StylePicker } from "@/components/generation/StylePicker";

// Shared across the generic/FramePack/LTX forms; all three executors apply
// the styles param server-side. Hidden entirely when no styles are saved.
export function VideoStylesSection() {
  const styles = useVideoStore((s) => s.styles);
  const setParam = useVideoStore((s) => s.setParam);
  const { data: available } = usePromptStyles();

  if (!Array.isArray(available) || available.length === 0) return null;

  return (
    <SectionLeader title="Styles" collapsible defaultCollapsed>
      <StylePicker selected={styles} onChange={(v) => setParam("styles", v)} />
    </SectionLeader>
  );
}
