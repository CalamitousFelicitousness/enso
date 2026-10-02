/** Latent upscaler used when the stored name is not one sdnext knows. */
export const DEFAULT_HIRES_UPSCALER = "Latent Bilinear";

/** Upscaler used in place of a latent one on a pipeline that takes pixels. */
export const PIXEL_HIRES_UPSCALER = "Resize Lanczos";

const DEFAULT_HIRES_DENOISING = 0.5;

/** sdnext upscales in latent space, and always runs the second pass, for
 * these names. */
export function isLatentUpscaler(name: string): boolean {
  return name.toLowerCase().startsWith("latent");
}

export interface HiresSettings {
  upscaler: string;
  force: boolean;
  denoising: number;
}

export interface HiresSupport {
  /** The pipeline reads its input images as pixels (request_sets_size), so a
   * latent cannot be upscaled for it. */
  pixelInput: boolean;
  /** The second pass takes a denoising strength. */
  strength: boolean;
}

/** Hires settings as shown and sent for the loaded model. A pixel-input
 * pipeline takes a pixel upscaler and always runs the second pass, which
 * sdnext otherwise runs only for a latent upscaler or with Force on. sdnext
 * skips the pass at strength 0 even where the pipeline ignores strength. */
export function effectiveHires(stored: HiresSettings, support: HiresSupport): HiresSettings {
  const named = stored.upscaler === "Latent" ? DEFAULT_HIRES_UPSCALER : stored.upscaler;
  const upscaler = support.pixelInput && isLatentUpscaler(named) ? PIXEL_HIRES_UPSCALER : named;
  const denoising =
    support.strength || stored.denoising > 0 ? stored.denoising : DEFAULT_HIRES_DENOISING;
  return { upscaler, force: support.pixelInput || stored.force, denoising };
}
