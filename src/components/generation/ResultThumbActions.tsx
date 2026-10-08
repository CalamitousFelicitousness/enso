import { ImagePlus, ArrowUpCircle, GitCompareArrows, Download } from "lucide-react";
import type { GenerationResult } from "@/stores/generationStore";
import { download, sendToCanvas, sendToUpscale } from "./resultActions";

interface ResultThumbActionsProps {
  result: GenerationResult;
  imageIndex: number;
  onCompare: () => void;
}

/** The picture's actions over the bottom of a thumbnail. Restores live in the
 * thumbnail's menu, where each says why it cannot act. */
export function ResultThumbActions({ result, imageIndex, onCompare }: ResultThumbActionsProps) {
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions -- bubble-firewall inside result thumbnail; the action <button>s inside own their own keyboard handling
    <div
      className="absolute bottom-0 left-0 right-0 flex justify-center gap-0.5 bg-gradient-to-t from-black/80 to-transparent pt-3 pb-0.5 px-0.5"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <ActionBtn onClick={() => sendToCanvas(result, imageIndex)} title="Send to canvas">
        <ImagePlus size={10} />
      </ActionBtn>
      <ActionBtn onClick={() => sendToUpscale(result, imageIndex)} title="Send to upscale">
        <ArrowUpCircle size={10} />
      </ActionBtn>
      <ActionBtn onClick={onCompare} title="Compare">
        <GitCompareArrows size={10} />
      </ActionBtn>
      <ActionBtn onClick={() => download(result, imageIndex)} title="Download">
        <Download size={10} />
      </ActionBtn>
    </div>
  );
}

function ActionBtn({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
      aria-label={title}
      className="w-5 h-5 flex items-center justify-center rounded text-white/80 hover:text-white hover:bg-white/20 transition-colors"
    >
      {children}
    </button>
  );
}
