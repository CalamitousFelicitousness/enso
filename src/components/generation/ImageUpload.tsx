import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { useDropTarget } from "@/hooks/useDropTarget";
import { dropFailed, payloadToFile } from "@/lib/sendTo";
import type { ImagePayload } from "@/lib/drag";
import { Button } from "@/components/ui/button";

interface ImageUploadProps {
  image: File | null;
  onImageChange: (file: File | null) => void;
  label?: string;
  compact?: boolean;
}

export function ImageUpload({
  image,
  onImageChange,
  label = "Drop image",
  compact = false,
}: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(() =>
    image ? URL.createObjectURL(image) : null,
  );

  // Revoke object URL on unmount
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- cleanup only on unmount

  const handleFile = useCallback(
    (file: File | null) => {
      if (preview) URL.revokeObjectURL(preview);
      if (file) {
        setPreview(URL.createObjectURL(file));
      } else {
        setPreview(null);
      }
      onImageChange(file);
    },
    [onImageChange, preview],
  );

  const { isOver: dragOver, ...dropHandlers } = useDropTarget({
    onDropImage: useCallback(
      (payload: ImagePayload) => {
        payloadToFile(payload).then(handleFile).catch(dropFailed);
      },
      [handleFile],
    ),
    onFileDrop: handleFile,
  });

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      handleFile(file);
      e.target.value = "";
    },
    [handleFile],
  );

  const size = compact ? "h-20" : "h-28";

  if (image && preview) {
    return (
      <div className={`relative ${size} rounded-md overflow-hidden border border-border group`}>
        <img src={preview} alt="Upload preview" className="w-full h-full object-cover" />

        <Button
          variant="destructive"
          size="icon-sm"
          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity h-5 w-5"
          onClick={() => handleFile(null)}
        >
          <X size={10} />
        </Button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className={`${size} w-full rounded-md border-2 border-dashed flex flex-col items-center justify-center cursor-pointer text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] ${dragOver ? "border-primary bg-primary/5" : "border-border"}`}
        {...dropHandlers}
        onClick={() => inputRef.current?.click()}
      >
        <Upload size={compact ? 14 : 16} className="mb-1" />
        <span className="text-3xs">{label}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onInputChange}
      />
    </>
  );
}
