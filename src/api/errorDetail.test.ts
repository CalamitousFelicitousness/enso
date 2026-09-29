import { describe, expect, it } from "vitest";
import { formatErrorDetail } from "./errorDetail";

// Bodies recorded from POST /sdapi/v2/jobs on the live backend
const STALE_PAGE = {
  detail: [
    "cfg_end",
    "diffusers_guidance_rescale",
    "image_cfg_scale",
    "pag_scale",
    "pag_adaptive",
  ].map((field) => ({
    type: "extra_forbidden",
    loc: ["body", "generate", field],
    msg: "Extra inputs are not permitted",
    input: 1,
  })),
};

const BAD_VALUES = {
  detail: [
    {
      type: "string_type",
      loc: ["body", "generate", "inputs", 1],
      msg: "Input should be a valid string",
      input: 5,
    },
    {
      type: "int_parsing",
      loc: ["body", "generate", "steps"],
      msg: "Input should be a valid integer, unable to parse string as an integer",
      input: "many",
    },
  ],
};

describe("formatErrorDetail", () => {
  it("groups the fields a stale page is refused for under their one message", () => {
    expect(formatErrorDetail(STALE_PAGE)).toBe(
      "generate.cfg_end, generate.diffusers_guidance_rescale, generate.image_cfg_scale, generate.pag_scale, generate.pag_adaptive: Extra inputs are not permitted",
    );
  });

  it("keeps distinct messages apart and shows list indexes", () => {
    expect(formatErrorDetail(BAD_VALUES)).toBe(
      "generate.inputs[1]: Input should be a valid string; generate.steps: Input should be a valid integer, unable to parse string as an integer",
    );
  });

  it("caps the fields listed per message", () => {
    const detail = Array.from({ length: 7 }, (_, i) => ({
      type: "extra_forbidden",
      loc: ["body", "generate", `f${i}`],
      msg: "Extra inputs are not permitted",
    }));
    expect(formatErrorDetail({ detail })).toBe(
      "generate.f0, generate.f1, generate.f2, generate.f3, generate.f4 +2 more: Extra inputs are not permitted",
    );
  });

  it("passes a string detail and a plain-text body through, and drops an HTML page", () => {
    expect(formatErrorDetail({ detail: "Model not found" })).toBe("Model not found");
    expect(formatErrorDetail("Bad Gateway\nupstream closed")).toBe("Bad Gateway");
    expect(formatErrorDetail("<html><body>502</body></html>")).toBeNull();
    expect(formatErrorDetail({ detail: [] })).toBeNull();
    expect(formatErrorDetail(null)).toBeNull();
  });

  it("names the exception sdnext's handler reports when detail is empty", () => {
    expect(formatErrorDetail(UNHANDLED)).toBe(
      "ImportError: cannot import name 'do_vqa' from 'modules.api.caption' (modules/api/caption.py)",
    );
    expect(
      formatErrorDetail({
        ...UNHANDLED,
        error: "RuntimeError",
        errors: "CUDA driver error: device not ready\nFailed to create GPU mapping",
      }),
    ).toBe("RuntimeError: CUDA driver error: device not ready");
    expect(formatErrorDetail({ error: "", errors: "" })).toBeNull();
  });
});

// Shape of sdnext's generic API exception handler: the reason sits in `errors`, detail stays empty
const UNHANDLED = {
  error: "ImportError",
  code: 500,
  detail: "",
  body: "",
  errors: "cannot import name 'do_vqa' from 'modules.api.caption' (modules/api/caption.py)",
};
