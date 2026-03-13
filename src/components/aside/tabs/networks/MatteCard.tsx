import { forwardRef } from "react";
import { motion } from "motion/react";
import { Info, ImageOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { api } from "@/api/client";
import { SmartCardImage } from "./SmartCardImage";
import { isExtraNetwork } from "./utils";
import type { NetworkItem } from "./types";
import type { ExtraNetworkV2 } from "@/api/types/models";

const neonDotStyle = {
  boxShadow: "0 0 6px oklch(from var(--primary) l c h / 0.6)",
};

export const MatteCard = forwardRef<
  HTMLDivElement,
  {
    item: NetworkItem;
    active: boolean;
    isActiveLora: boolean;
    onClick: () => void;
    onInfo: () => void;
  }
>(function MatteCard({ item, active, isActiveLora, onClick, onInfo }, ref) {
  const network = isExtraNetwork(item) ? (item as ExtraNetworkV2) : null;
  const badgeText = network ? (network.version || network.type) : "Style";

  const preview = item.preview;
  const previewUrl = preview
    ? preview.startsWith("data:") || preview.startsWith("http")
      ? preview
      : `${api.getBaseUrl()}${preview}`
    : null;

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{
        opacity: { duration: 0.2, ease: "easeInOut" },
        scale: { duration: 0.2, ease: "easeInOut" },
        layout: { duration: 0.25, ease: [0.4, 0, 0.2, 1] },
      }}
      className="relative rounded-lg transition-all duration-200 cursor-pointer group hover:shadow-lg hover:shadow-black/20"
      onClick={onClick}
    >
      <div className="aspect-[3/4] w-full overflow-hidden rounded-lg relative bg-black">
        {previewUrl ? (
          <SmartCardImage
            src={previewUrl}
            alt={item.name}
            imgClassName="transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="size-full flex items-center justify-center bg-muted/30">
            <ImageOff className="h-6 w-6 text-muted-foreground/40" />
          </div>
        )}
      </div>

      {/* Glow border overlay */}
      <div
        className={`absolute inset-0 rounded-lg pointer-events-none z-20 transition-all duration-200
          ${active ? "ring-1 ring-primary/40 shadow-lg shadow-primary/5" : "ring-1 ring-border/30 group-hover:ring-primary/40"}`}
      />

      {/* Family pill + active dot — top-right */}
      <div className="absolute top-2 right-2 flex items-center gap-1.5 z-10">
        {isActiveLora && (
          <div
            className="size-2 rounded-full bg-primary shrink-0"
            style={neonDotStyle}
          />
        )}
        <Badge
          className="border-transparent text-primary px-1.5 py-0 text-4xs uppercase tracking-wider font-medium dark:bg-[rgb(17,17,24)]/65 bg-white/65 backdrop-blur-[12px] ring-1 ring-primary/40"
        >
          {badgeText}
        </Badge>
      </div>

      {/* Frosted glass info strip */}
      <div
        className="absolute -bottom-px -inset-x-px px-3 py-2.5 backdrop-blur-xl border-t dark:border-white/[0.05] border-black/[0.05] rounded-b-lg dark:bg-[rgb(17,17,24)]/2.5 bg-white/2.5"
      >
        <div className="flex items-end gap-1.5">
          <span className="text-[0.6875rem] font-medium line-clamp-3 leading-tight text-foreground flex-1 break-words">
            {item.name}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onInfo();
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded-full text-muted-foreground hover:text-foreground shrink-0"
          >
            <Info className="h-3 w-3" />
          </button>
        </div>
      </div>
    </motion.div>
  );
});
