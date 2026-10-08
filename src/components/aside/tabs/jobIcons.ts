import {
  AudioLines,
  Database,
  Image,
  LayoutGrid,
  MessageSquare,
  ScanSearch,
  SlidersHorizontal,
  Sparkles,
  Video,
  type LucideIcon,
} from "lucide-react";
import type { JobIcon } from "@/lib/jobs/domains";

export const JOB_ICONS: Record<JobIcon, LucideIcon> = {
  image: Image,
  video: Video,
  sparkles: Sparkles,
  sliders: SlidersHorizontal,
  grid: LayoutGrid,
  message: MessageSquare,
  scan: ScanSearch,
  audio: AudioLines,
  database: Database,
};
