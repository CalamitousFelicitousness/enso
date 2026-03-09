import { useState, useCallback, useRef } from "react";
import { Wrench, FileSearch, ScanSearch, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PngInfoDialog } from "@/components/generation/PngInfoDialog";
import { QuickInterrogateDialog } from "@/components/generation/QuickInterrogateDialog";
import { sendImageToCanvas } from "@/lib/sendTo";
import { toast } from "sonner";

export function ImageToolsMenu() {
  const [pngInfoOpen, setPngInfoOpen] = useState(false);
  const [interrogateOpen, setInterrogateOpen] = useState(false);
  const [interrogateFile, setInterrogateFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileActionRef = useRef<"interrogate" | "canvas">("interrogate");

  const handleFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";
      if (fileActionRef.current === "interrogate") {
        setInterrogateFile(file);
        setInterrogateOpen(true);
      } else {
        await sendImageToCanvas(file);
        toast.success("Image sent to canvas");
      }
    },
    [],
  );

  const openFilePicker = useCallback((action: "interrogate" | "canvas") => {
    fileActionRef.current = action;
    fileInputRef.current?.click();
  }, []);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Image tools"
            className="text-muted-foreground"
          >
            <Wrench size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setPngInfoOpen(true)}>
            <FileSearch size={14} /> Extract PNG Info
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openFilePicker("interrogate")}>
            <ScanSearch size={14} /> Quick Interrogate
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openFilePicker("canvas")}>
            <ImagePlus size={14} /> Send Image to Canvas
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileInput}
      />
      <PngInfoDialog open={pngInfoOpen} onOpenChange={setPngInfoOpen} />
      <QuickInterrogateDialog
        open={interrogateOpen}
        onOpenChange={setInterrogateOpen}
        file={interrogateFile}
      />
    </>
  );
}
