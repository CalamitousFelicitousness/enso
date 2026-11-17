import type { HdrSupport } from "@/api/types/process";
import type { ProcessMode } from "@/api/types/v2";

/** The HDR section: its controls with a line on the file it writes, or why it writes none. */
export type HdrState =
  | { readonly applies: true; readonly note: string }
  | { readonly applies: false; readonly hint: string };

export const HDR_IMAGES_ONLY = "HDR runs on Image and Batch inputs.";
export const HDR_NEEDS_SAVE = "HDR writes a file beside each saved image. Turn on Save output.";
export const HDR_NO_STEP = "This server cannot write HDR files. Update SD.Next to use HDR.";
export const HDR_NO_FORMAT = "This server cannot write HDR in any image file format.";

const KINDS: Readonly<Record<string, string>> = {
  "jpeg-gain-map": "a JPEG with an HDR gain map",
  "png-cicp": "a 16-bit HDR PNG",
  tiff16: "a 16-bit HDR TIFF",
  avif: "an HDR AVIF",
  jxl: "an HDR JPEG XL",
  exr: "an OpenEXR file",
};

const upper = (format: string) => format.toUpperCase();

/** "A", "A or B", "A, B or C". */
function either(names: readonly string[]): string {
  return names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

/** What HDR does for the image file format the server saves in (`format`), given the
 * server's table of formats (undefined while it loads, empty without the HDR step). */
export function hdrState(
  formats: readonly HdrSupport[] | undefined,
  format: string | undefined,
  mode: ProcessMode,
  saveOutput: boolean,
): HdrState {
  if (mode !== "image" && mode !== "batch") return { applies: false, hint: HDR_IMAGES_ONLY };
  if (!saveOutput) return { applies: false, hint: HDR_NEEDS_SAVE };
  if (formats === undefined || format === undefined) return { applies: true, note: "" };
  if (formats.length === 0) return { applies: false, hint: HDR_NO_STEP };
  const row = formats.find((f) => f.samples_format === format);
  if (row?.available) {
    const extension = row.extension ?? format;
    const kind = (row.hdr_format && KINDS[row.hdr_format]) || `an HDR ${upper(extension)} file`;
    const install =
      row.installs && row.encoder ? ` The first run installs ${row.encoder} on the server.` : "";
    return {
      applies: true,
      note: `Writes ${kind} beside each saved image, ending in -hdr.${extension}.${install}`,
    };
  }
  const usable = formats.flatMap((f) =>
    f.available && f.samples_format ? [upper(f.samples_format)] : [],
  );
  if (usable.length === 0) return { applies: false, hint: HDR_NO_FORMAT };
  if (row?.code === "encoder-missing" && row.encoder) {
    return {
      applies: false,
      hint: `HDR in ${upper(format)} needs ${row.encoder} on the server, which is not installed. ${either(usable)} work without it: set the image file format in Settings.`,
    };
  }
  return {
    applies: false,
    hint: `${upper(format)} images cannot hold HDR. Set the image file format to ${either(usable)} in Settings.`,
  };
}
