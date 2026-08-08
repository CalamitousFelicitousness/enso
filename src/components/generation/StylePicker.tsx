import { X } from "lucide-react";
import { usePromptStyles } from "@/api/hooks/useNetworks";
import { Combobox } from "@/components/ui/combobox";

interface StylePickerProps {
  selected: string[];
  onChange: (styles: string[]) => void;
}

// Chips + combobox for picking saved prompt styles by name. Selections are
// sent as the wire-level `styles` param and applied server-side, which keeps
// {prompt} placeholder substitution and infotext style recording intact
// (unlike the Networks browser, which injects style text into the prompt).
// Callers gate rendering on usePromptStyles themselves when the surrounding
// section frame should disappear along with the picker.
export function StylePicker({ selected, onChange }: StylePickerProps) {
  const { data: styles } = usePromptStyles();
  if (!Array.isArray(styles) || styles.length === 0) return null;

  return (
    <>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1">
          {selected.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-3xs bg-muted rounded"
            >
              {name}
              <button
                onClick={() => onChange(selected.filter((s) => s !== name))}
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      <Combobox
        value=""
        onValueChange={(name) => {
          if (!selected.includes(name)) onChange([...selected, name]);
        }}
        options={styles.filter((s) => !selected.includes(s.name)).map((s) => s.name)}
        placeholder="Add style..."
        className="h-6 text-2xs"
      />
    </>
  );
}
