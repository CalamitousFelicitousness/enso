import type {
  ControlUnitParams,
  DetailerModelEntry as WireDetailerModelEntry,
  DetailerOverrides as WireDetailerOverrides,
  GenerateParams,
  IpAdapterUnitParams,
} from "@/lib/openapi-generated/types.gen";
import type { DetailerModelEntry, DetailerOverrides } from "./v2";

/** A generated wire type whose fields may also be set to undefined, which JSON
 * drops; builders assign conditionally under exactOptionalPropertyTypes. */
type Settable<T> = { [K in keyof T]?: T[K] | undefined };

/** `Client` while it names exactly the fields of `Wire`, else `never`. */
type SameFields<Client, Wire> = [keyof Client, keyof Wire] extends [keyof Wire, keyof Client]
  ? Client
  : never;

export type ControlRequestUnit = Settable<ControlUnitParams>;
export type IpAdapterRequestUnit = Settable<IpAdapterUnitParams>;

/** Body of a generate job, from the server's schema. The detailer fields keep
 * the client's types (absent where the server allows null), checked against
 * the server's field names. */
export type ControlRequest = Settable<
  Omit<
    GenerateParams,
    "type" | "priority" | "control" | "ip_adapter" | "detailer_defaults" | "detailer_models"
  >
> & {
  prompt: string;
  control?: ControlRequestUnit[] | undefined;
  ip_adapter?: IpAdapterRequestUnit[] | undefined;
  detailer_defaults?: SameFields<DetailerOverrides, WireDetailerOverrides> | undefined;
  detailer_models?: (string | SameFields<DetailerModelEntry, WireDetailerModelEntry>)[] | undefined;
};

export interface ControlResponse {
  images: string[];
  processed: string[];
  params: Record<string, unknown>;
  info: string;
}

export interface GenerationInfo {
  prompt: string;
  negative_prompt: string;
  seed: number;
  subseed: number;
  width: number;
  height: number;
  sampler_name: string;
  cfg_scale: number;
  steps: number;
  batch_size: number;
  model: string;
  model_hash: string;
  job_timestamp: string;
  [key: string]: unknown;
}
