import { useState } from "react";
import { Check } from "lucide-react";
import { useHfSettings, useHfMe } from "@/api/hooks/useHuggingface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * HuggingFace token control for the Settings tab.
 *
 * Shows "Signed in as <user>" when configured, otherwise an input field.
 * The input feeds into the Settings tab's dirty state via `onChange` -
 * the actual save + validation happens in handleApply (SettingsView).
 */
export function HfTokenControl({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [editing, setEditing] = useState(false);
  const { data: settings } = useHfSettings();
  const configured = settings?.token_configured ?? false;
  const { data: profile } = useHfMe(configured);
  const draft = String(value ?? "");

  if (configured && !editing) {
    return (
      <div className="flex items-center gap-2">
        <Check className="h-3 w-3 text-green-500 shrink-0" />
        {profile?.avatar ? (
          <img
            src={profile.avatar}
            alt=""
            className="h-5 w-5 rounded-full shrink-0 object-cover"
          />
        ) : null}
        <span className="text-2xs text-muted-foreground">
          {profile?.username
            ? `Signed in as ${profile.username}`
            : "Token configured"}
        </span>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => setEditing(true)}
        >
          Change
        </Button>
        <Button
          size="xs"
          variant="ghost"
          className="text-destructive"
          onClick={() => {
            onChange("");
            setEditing(false);
          }}
        >
          Remove
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        placeholder="Paste token..."
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        className="h-6 text-2xs flex-1"
      />
      {editing && (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            setEditing(false);
            onChange("");
          }}
        >
          Cancel
        </Button>
      )}
    </div>
  );
}
