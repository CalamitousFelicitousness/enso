/** A diffusers pipeline class without the Pipeline suffix and task variant:
 * QwenImage21Pipeline becomes QwenImage21. */
export function formatPipelineClass(cls: string | null | undefined): string | null {
  if (!cls) return null;
  return cls.replace(/Pipeline$/, "").replace(/Img2Img$|Inpaint$/, "");
}
