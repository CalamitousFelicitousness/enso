import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { api } from "@/api/client";
import type { ActiveLora } from "./types";

const EASE = [0.4, 0, 0.2, 1] as const;

export function ActiveLoraStack({
  activeLoras,
  loraPreviewMap,
  onRemove,
  onWeightChange,
}: {
  activeLoras: ActiveLora[];
  loraPreviewMap: Map<string, string | null>;
  onRemove: (name: string) => void;
  onWeightChange: (name: string, weight: number) => void;
}) {
  return (
    <AnimatePresence initial={false}>
      {activeLoras.length > 0 && (
        <motion.div
          key="lora-stack-container"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{
            height: { duration: 0.3, ease: EASE },
            opacity: { duration: 0.2, ease: "easeInOut" },
          }}
          className="overflow-hidden"
        >
          <div className="flex flex-col gap-1.5 pt-0.5 pb-1">
            <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
              Active LoRAs
            </span>
            <div className="flex flex-col gap-1.5">
              <AnimatePresence initial={false} mode="sync">
                {activeLoras.map((lora) => {
                  const preview = loraPreviewMap.get(lora.name);
                  const previewUrl = preview
                    ? preview.startsWith("data:") || preview.startsWith("http")
                      ? preview
                      : `${api.getBaseUrl()}${preview}`
                    : null;

                  return (
                    <motion.div
                      key={lora.name}
                      layout
                      initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                      animate={{ opacity: 1, height: "auto", marginBottom: 0 }}
                      exit={{ opacity: 0, height: 0, marginBottom: -6 }}
                      transition={{
                        opacity: { duration: 0.2, ease: "easeInOut" },
                        height: { duration: 0.3, ease: EASE },
                        marginBottom: { duration: 0.3, ease: EASE },
                        layout: { duration: 0.3, ease: EASE },
                      }}
                      className="overflow-hidden"
                    >
                      <div className="flex items-center gap-2.5 px-3 py-2 rounded-md backdrop-blur-xl border dark:border-white/[0.05] border-black/[0.05] dark:bg-[rgb(17,17,24)]/80 bg-white/80 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03),0_2px_8px_rgba(0,0,0,0.3)]">
                        {previewUrl ? (
                          <img
                            src={previewUrl}
                            alt={lora.name}
                            className="size-6 rounded object-cover shrink-0"
                          />
                        ) : (
                          <div className="size-6 rounded bg-muted/30 shrink-0" />
                        )}
                        <span className="text-[0.6875rem] text-foreground truncate min-w-0 flex-shrink">
                          {lora.name}
                        </span>
                        <Slider
                          value={[lora.weight]}
                          min={0}
                          max={1}
                          step={0.05}
                          onValueChange={([v]) =>
                            onWeightChange(lora.name, v)
                          }
                          className="flex-1 min-w-16"
                        />
                        <span className="font-mono text-4xs tabular-nums text-foreground shrink-0 w-8 text-right">
                          {lora.weight.toFixed(2)}
                        </span>
                        <button
                          type="button"
                          onClick={() => onRemove(lora.name)}
                          className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
