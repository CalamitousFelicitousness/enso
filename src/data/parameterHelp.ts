/**
 * Enso's override layer over the SD.Next hint baseline.
 *
 * The baseline (`localeHints`, generated from `src/data/locale_en.snapshot.json`)
 * provides the upstream hint for every SD.Next label. This map holds only Enso's
 * divergences: labels SD.Next does not ship (Enso-specific sections, latent/HDR
 * correction controls, renamed labels) and the few where Enso's wording is
 * preferred over upstream. `getParamHelp` returns the override when present,
 * otherwise the baseline.
 *
 * To pull new upstream hints, run `npm run locale:refresh` (updates the snapshot);
 * the baseline regenerates on the next dev/build. Add an entry here only to keep an
 * Enso-specific hint that should not track upstream.
 *
 * Generation tooltips may use HTML; settings descriptions are stripped to plain
 * text via getParamHelpPlain.
 */
import { localeHints } from "@/lib/localeHints.generated";

export const parameterHelp = new Map<string, string>([
  ["add number", "Add sequence number to filenames"],
  [
    "apply to hires",
    "When enabled, latent corrections (brightness, color, tint, sharpen, clamp, maximize) are applied again during the hires fix pass.<br><br>Disable if the hires pass over-corrects - the base pass already bakes corrections into the latent before upscaling. Detailer passes always skip corrections regardless of this setting.",
  ],
  ["auto-load model", "Automatically load selected model on startup"],
  ["checkpoint", "Active model checkpoint"],
  [
    "chunk size",
    "Batch size for processing description candidates (flavors). Higher values speed up interrogation but increase VRAM usage.",
  ],
  [
    "clip num beams",
    "Number of beams for beam search during caption generation. Higher values search more possibilities but are slower.",
  ],
  ["codeformer weight", "CodeFormer fidelity vs enhancement weight"],
  [
    "color correction enabled",
    "Match output colors to the input image. Active for img2img, inpainting, and edit pipelines.",
  ],
  [
    "color correction method",
    "Algorithm used to transfer colors from the input image.<br><br><b>Histogram</b> - matches color distributions channel by channel in LAB space.<br><b>Wavelet</b> - preserves fine detail by transferring only low-frequency color.<br><b>AdaIN</b> - normalizes mean and variance per channel for a style-transfer effect.",
  ],
  [
    "color temp (k)",
    "Shifts the color temperature of the image in Kelvin. Lower values (2000K) produce warm, golden tones. Higher values (12000K) produce cool, blue tones. 6500K is neutral daylight.",
  ],
  ["comma padding", "Backtrack padding when splitting long prompts"],
  ["compile backend", "Torch compile backend for inference optimization"],
  ["cross attention", "Cross attention optimization method"],
  ["cuda dtype", "Default tensor dtype for CUDA"],
  [
    "detailer blur",
    "Blur applied to the edges of each detected region's mask. Softens transitions between the re-generated area and the surrounding image.",
  ],
  [
    "detailer padding",
    "Extra pixels added around each detected region before processing. Gives the model more context for seamless blending.",
  ],
  ["disable half precision", "Run entire model in full precision"],
  ["enable in main ui", "Show postprocessing options in main generation UI"],
  ["enable previews", "Show live previews during generation"],
  ["face model", "Face restoration model"],
  ["face restoration", "Apply face restoration to generated images"],
  ["filename pattern", "Custom filename pattern (empty = default)"],
  ["full precision vae", "Run VAE in full precision (fixes NaN issues)"],
  [
    "grading brightness",
    "Adjusts overall image brightness after generation. Positive values lighten, negative values darken. Applied as a pixel-level adjustment on the decoded image.",
  ],
  [
    "grading contrast",
    "Adjusts the difference between light and dark areas. Positive values increase contrast, negative values flatten the tonal range. 0 leaves the image unchanged.",
  ],
  [
    "grading gamma",
    "Applies a non-linear brightness curve. Values below 1.0 brighten midtones and shadows, values above 1.0 darken them. Default is 1.0 (no change).",
  ],
  [
    "grading grain",
    "Adds random film grain noise to the final image. Higher values produce more visible texture. 0 disables the effect.",
  ],
  [
    "grading highlights",
    "Adjusts the brightness of highlight regions. Positive values brighten highlights, negative values pull them back to recover blown-out detail. Operates in Lab color space.",
  ],
  [
    "grading hue",
    "Rotates the entire color spectrum. 0 and 1 leave colors unchanged, 0.5 shifts all hues by 180 degrees (complementary colors). Useful for creative color shifts.",
  ],
  [
    "grading midtones",
    "Adjusts the brightness of midtone values without affecting deep shadows or bright highlights. Useful for fine-tuning overall image exposure.",
  ],
  [
    "grading saturation",
    "Adjusts color intensity. Positive values make colors more vivid, negative values desaturate toward grayscale. 0 leaves the image unchanged.",
  ],
  [
    "grading shadows",
    "Lightens or darkens the shadow regions of the image. Positive values lift shadows to reveal detail, negative values deepen them. Operates in Lab color space.",
  ],
  [
    "grading sharpness",
    "Enhances edge definition in the final image using an unsharp mask filter. Higher values produce crisper detail. 0 disables sharpening.",
  ],
  [
    "grading vignette",
    "Adds radial edge darkening that draws the eye toward the center of the image. Higher values produce a more pronounced dark border. 0 disables the effect.",
  ],
  ["grid format", "Grid image format"],
  [
    "hdr clamp",
    "Prunes extreme latent values early in denoising (timestep &gt; 950) to reduce artifacts at high guidance scales.<br><br>Outliers beyond <b>Range × Threshold</b> are smoothly compressed back toward the distribution mean using soft clamping - not hard clipping.",
  ],
  [
    "hdr maximize",
    "Normalizes the latent tensor to fill the full dynamic range in the final denoising steps (timestep 1-100).<br><br>Each channel is first centered (controlled by Center), then the entire tensor is scaled so the peak value reaches <b>Range × 4</b>. Idempotent - applying it multiple times has the same effect as once.",
  ],
  [
    "hdr maximize center",
    "How strongly each channel is centered before maximizing.<br><br>At 0 = no centering. At 1.0 = each channel's mean is fully subtracted. Higher values over-center, which can invert subtle color biases.",
  ],
  [
    "hdr maximize range",
    "Target dynamic range after normalization, as a multiplier of the default boundary (4.0).<br><br>At 1.0 = peak latent value reaches ±4. Below 1.0 = compressed range (lower contrast). Above 1.0 = expanded range (higher contrast).",
  ],
  [
    "hires fit",
    "How to adapt the image when target dimensions differ from the source aspect ratio:<br>- <b>Stretch</b>: force to exact dimensions (may distort)<br>- <b>Crop</b>: resize and center-crop to fill target<br>- <b>Fill</b>: resize to fit and pad borders<br>- <b>Outpaint</b>: extend canvas beyond image edges<br>- <b>Context aware</b>: smart resize that blends surrounding areas",
  ],
  [
    "hires size",
    "How the hires target resolution is determined:<br>- <b>Scale</b>: multiply base width/height by a scale factor<br>- <b>Fixed</b>: specify exact target dimensions with a fit method",
  ],
  ["image format", "Output image format"],
  ["img2img upscaler", "Upscaler for img2img resize"],
  [
    "inpaint full res",
    "Crop the masked region, upscale it to full resolution, inpaint, then paste back. Gives finer detail on small masks",
  ],
  ["input", "Show/hide selection of input media used to guide generation"],
  ["input media", "Add input image to be used for image-to-image, inpaint or control processing"],
  [
    "intermediates",
    "Size of the intermediate candidate pool when matching image features to descriptive tags (flavours). From this pool, the final tags are selected based on Min/Max Flavors. Higher values may improve quality but are slower.",
  ],
  ["jpeg quality", "Quality for JPEG/WebP output"],
  [
    "latent brightness",
    "Additive offset to channel 0 (luminance) during late denoising (timestep &lt; 200).<br><br><b>Relative mode:</b> adds the value directly - e.g. 0.1 shifts the luminance mean up by ~0.1 in latent space (typical range ±3).<br><b>Absolute mode:</b> first subtracts the channel mean, then adds the offset - centering luminance before shifting.<br><br>The total offset is spread evenly across all active steps in the range, so the slider value represents the cumulative shift.",
  ],
  [
    "latent clamp range",
    'The boundary defining the "normal" range for latent values. Clamping targets values beyond <b>Threshold × Range</b>.<br><br>Default 4.0 covers most of the typical latent distribution. Lower values clamp more of the distribution; higher values only affect extreme outliers.',
  ],
  [
    "latent clamp threshold",
    "Fraction of the Range at which soft clamping begins. At 0.95 (default), values beyond 95% of the boundary are smoothly compressed.<br><br>Lower = more aggressive clamping. Higher = only extreme outliers affected.",
  ],
  [
    "latent color",
    "Centers chrominance channels (1-3) during mid-stage denoising (timestep 600-900).<br><br>Each channel's spatial mean is subtracted, scaled by this value. At 1.0, the mean is fully removed (zero-centering). At 4.0 (max), it over-corrects - useful for desaturating color casts.<br><br>The total correction is spread evenly across all active steps in the range.",
  ],
  [
    "latent mode",
    "<b>Relative</b> (default): brightness and color shift values around their current mean - the image's existing tone is preserved and nudged.<br><b>Absolute</b>: the channel mean is first subtracted (centering to zero), then the offset is applied - the image's original tone is discarded.",
  ],
  [
    "latent sharpen",
    "Sharpens or softens the latent during late denoising (timestep &lt; 350) using a 3×3 convolution kernel.<br><br>The per-step strength scales with the timestep: stronger early, weaker late. Positive values sharpen edges, negative values blur. Output is soft-clamped to prevent artifacts.",
  ],
  [
    "lut file",
    "Upload a .cube LUT (Look-Up Table) file to apply cinematic or stylized color grading. The LUT is applied as the final step after all other color adjustments.",
  ],
  ["mask overlay", "Apply the original unmasked area on top of the generated result"],
  ["mask padding", "Extra pixels around the cropped mask region when using inpaint full res"],
  [
    "mask strength",
    "Inpainting conditioning mask strength. 1.0 means fully masked, 0.0 means fully unmasked. Lower values preserve more of the original composition",
  ],
  ["max flavors", "Maximum number of descriptive tags (flavors) to keep in the final prompt."],
  ["max length", "Maximum number of tokens in the generated caption."],
  ["mean normalization", "Normalize prompt embeddings with mean"],
  ["min flavors", "Minimum number of descriptive tags (flavors) to keep in the final prompt."],
  ["offload mode", "Memory offloading strategy"],
  [
    "output",
    "Show/hide selection of output media: generation resuls and live previews during generation process",
  ],
  [
    "pag scale",
    "Perturbed Attention Guidance scale. Improves sample quality by guiding denoising away from structurally degraded self-attention maps. Works without a negative prompt. 0 disables PAG. Recommended value around 3.0; too high may over-smooth textures.",
  ],
  ["pipeline", "Diffusers pipeline type"],
  ["precision", "Computation precision mode"],
  ["preview interval", "Show preview every N steps (0 = disabled)"],
  ["preview method", "Live preview decode method"],
  ["processed", "Show/hide section with processed images"],
  [
    "processed preview",
    "Show/hide section from pre-processing of input images before actual generate",
  ],
  ["prompt attention", "Prompt attention parser implementation"],
  ["refine guidance scale", "CFG scale used for refiner pass.<br><br>Also known as <b>CFG</b>."],
  ["refiner", "Refiner model for two-stage generation"],
  ["save grids", "Save image grids when batch > 1"],
  ["save images", "Save generated images to disk"],
  ["save to subdirs", "Save images into date-based subdirectories"],
  [
    "section hires fix",
    "Upscale the image and run a second diffusion pass to add detail at the higher resolution.<br><br><b>Pipeline order:</b> runs after base generation (and refiner, if enabled).<br><br>Uses GPU for a second sampling pass - slower but produces sharper detail than a pure upscale. Set <b>Force hires</b> to always run the diffusion pass even with non-latent upscalers.",
  ],
  [
    "section refiner",
    "Run a second model (refiner) partway through generation for improved quality.<br><br><b>Pipeline order:</b> runs during base generation, taking over at the specified start point.<br><br>Only useful with model architectures that have dedicated refiner checkpoints (e.g. SDXL). The refiner handles the final denoising steps using a model trained for fine detail.",
  ],
  [
    "section upscale",
    "Apply a pure upscaling model to the final output - no diffusion, just resize.<br><br><b>Pipeline order:</b> runs last, after hires fix (if enabled).<br><br>Fast and lightweight - uses an upscaling model (SiAX, ESRGAN, etc.) without any sampling steps. Use this alone for a quick upscale, or after hires fix to push resolution further than your GPU can handle in a single diffusion pass.",
  ],
  ["show", "Show image location"],
  ["sidebar", "Right Panel tabs on the right side of the screen"],
  ["text encoder model", "Text encoder override"],
  [
    "timesteps preset",
    "Select a predefined timestep schedule. When set, overrides the default evenly-spaced timesteps with a curated sequence.",
  ],
  [
    "tint color",
    "Pick a color to tint the latent during mid-stage denoising. The color is encoded into latent space via TAESD and blended according to Tint strength.<br>Set to <b>#000000</b> (black) to disable.",
  ],
  [
    "tint strength",
    "Controls how strongly the selected tint color is applied to the latent. Positive values shift toward the tint, negative values shift away from it. 0 disables the tint.",
  ],
  ["vae upcast", "Upcast VAE to float32 for computation"],
]);

/** Look up help text for a parameter label (case-insensitive). Enso overrides win over the SD.Next baseline. */
export function getParamHelp(label: string): string | undefined {
  const key = label.toLowerCase();
  return parameterHelp.get(key) ?? localeHints.get(key);
}

/** Look up help text and strip HTML tags for plain-text contexts (e.g. settings descriptions). */
export function getParamHelpPlain(label: string): string | undefined {
  const text = getParamHelp(label);
  return text ? text.replace(/<[^>]+>/g, "") : undefined;
}
