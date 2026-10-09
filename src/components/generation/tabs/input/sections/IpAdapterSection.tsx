// Which IP-Adapter an IP-Adapter frame's pictures feed, how strongly, and
// the region masks that confine each one.

import { X } from "lucide-react";
import { useIPAdapterModels } from "@/api/hooks/useAdapters";
import { SectionLeader } from "@/components/ui/section-leader";
import { Combobox } from "@/components/ui/combobox";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { ImageUpload } from "@/components/generation/ImageUpload";
import { useInputStore, type NewPicture } from "@/stores/inputStore";
import { imageSize } from "@/inputs/media";
import { useThumb } from "@/inputs/thumbs";
import type { Frame, Picture } from "@/lib/inputs/types";
import { Row } from "../Row";

async function toNewPicture(file: File): Promise<NewPicture> {
  const snapshot = new File([await file.arrayBuffer()], file.name, { type: file.type });
  const { width, height } = await imageSize(snapshot);
  return { file: snapshot, name: file.name, width, height };
}

function Thumb({ picture, onRemove }: { picture: Picture; onRemove: () => void }) {
  const url = useThumb(picture.file && { ...picture, file: picture.file });
  return (
    <div className="relative h-16 w-16 rounded border border-border overflow-hidden group">
      {url && <img src={url} alt={picture.name} className="w-full h-full object-cover" />}
      <Button
        variant="destructive"
        size="icon-sm"
        className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 h-4 w-4"
        onClick={onRemove}
        title={`Remove ${picture.name}`}
      >
        <X size={8} />
      </Button>
    </div>
  );
}

/** The region masks, one per picture, in picture order. */
export function IpAdapterSection({ frame }: { frame: Frame }) {
  const patchIpAdapter = useInputStore((s) => s.patchIpAdapter);
  const addIpMask = useInputStore((s) => s.addIpMask);
  const removeIpMask = useInputStore((s) => s.removeIpMask);
  const { data: adapters } = useIPAdapterModels();
  const settings = frame.ipAdapter;
  const set = (patch: Parameters<typeof patchIpAdapter>[1]) => patchIpAdapter(frame.id, patch);

  return (
    <SectionLeader title="IP-Adapter" collapsible>
      <Row label="Adapter">
        <Combobox
          value={settings.adapter}
          onValueChange={(v) => set({ adapter: v })}
          options={["None", ...(adapters ?? [])]}
          className="h-6 text-2xs flex-1"
        />
      </Row>
      <ParamSlider
        label="Scale"
        tooltip="How strongly the references pull the generation towards them."
        keywords={["ip adapter weight", "reference strength"]}
        value={settings.scale}
        onChange={(v) => set({ scale: v })}
        min={0}
        max={2}
        step={0.01}
      />
      <Row label="Crop">
        <Switch checked={settings.crop} onCheckedChange={(crop) => set({ crop })} />
      </Row>
      <div className="flex flex-col gap-1">
        <Label className="text-2xs text-muted-foreground">Masks</Label>
        <div className="flex gap-1 flex-wrap">
          {settings.masks.map((p) => (
            <Thumb key={p.id} picture={p} onRemove={() => removeIpMask(frame.id, p.id)} />
          ))}
        </div>
        <ImageUpload
          image={null}
          onImageChange={(file) => {
            if (file) void toNewPicture(file).then((p) => addIpMask(frame.id, p));
          }}
          label="Add mask"
          compact
        />
      </div>
    </SectionLeader>
  );
}
