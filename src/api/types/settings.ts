import type {
  ItemSectionInfoV2 as GenSectionMeta,
  OptionUpdateItemV2 as GenOptionUpdateItem,
} from "@/lib/openapi-generated/types.gen";

export type SectionMeta = GenSectionMeta;
export type OptionUpdateItem = GenOptionUpdateItem;

// OptionInfoMeta + OptionsInfoResponse stay hand-written. The Pydantic
// side uses `type: str` and `component: str` because SD.Next's options
// registry is dynamic; the TS-side narrows to the literal unions actually
// emitted. Aliasing from generated would cascade `string` through every
// consumer's switch-on-type and switch-on-component, losing the narrowing
// that buildSettingDef and friends rely on.

export type OptionsMap = Record<string, unknown>;

export interface OptionInfoMeta {
  label: string;
  section_id: string | null;
  section_title: string;
  visible: boolean;
  hidden: boolean;
  type: "boolean" | "number" | "string" | "array";
  component:
    | "slider"
    | "switch"
    | "radio"
    | "dropdown"
    | "input"
    | "number"
    | "color"
    | "checkboxgroup"
    | "separator";
  component_args: {
    minimum?: number;
    maximum?: number;
    step?: number;
    choices?: string[];
    precision?: number;
    multiselect?: boolean;
  };
  default?: unknown;
  is_legacy: boolean;
  is_secret: boolean;
}

export interface OptionsInfoResponse {
  options: Record<string, OptionInfoMeta>;
  sections: SectionMeta[];
}

export interface SetOptionsResponse {
  ok: boolean;
  updated: OptionUpdateItem[];
}
