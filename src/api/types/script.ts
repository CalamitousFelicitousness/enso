// Hand-written: ItemScriptV2.args in OpenAPI is `Array<unknown>` (Pydantic
// `list = Field(default_factory=list)`), which doesn't carry the ScriptArg
// shape consumers rely on. Tightening Pydantic side (adding a ScriptArg model
// and typing ItemScriptV2.args as list[ScriptArg]) is a follow-up that would
// unlock a generated mirror here.

export interface ScriptArg {
  label: string;
  value: unknown;
  minimum?: number;
  maximum?: number;
  step?: number;
  choices?: string[];
}

export interface ScriptInfo {
  name: string;
  is_alwayson: boolean;
  is_img2img: boolean;
  args: ScriptArg[];
}

export interface ScriptsList {
  txt2img: string[];
  img2img: string[];
  control: string[];
}

export interface ScriptInfoV2 {
  name: string;
  is_alwayson: boolean;
  contexts: string[];
  args: ScriptArg[];
}

export interface ScriptsResponse {
  scripts: ScriptInfoV2[];
}
