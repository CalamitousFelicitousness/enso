// What each role does, for the role toggle's tooltips and the inspector.

import type { FrameRole } from "@/lib/inputs/types";

// HTML, rendered through the styled Tooltip path (matte glass plus
// <b>/<i>/<br> formatting) rather than the native title attribute.
export const ROLE_HINTS: Record<FrameRole, string> = {
  initial:
    "<b>Initial</b> sends exactly what the frame shows: all visible layers " +
    "flattened at the output size, so you decide the composition and framing.<br><br>" +
    "On models with <i>Denoise</i>, it sets how far the result departs from this " +
    "image, and mask painting (inpaint) applies. Edit models such as <i>Klein</i> " +
    "and <i>Qwen-Image</i> take it as the image to edit.<br><br>" +
    "When other frames hold images too, it goes to the model as one image of the " +
    "set, without Denoise or mask.",
  reference:
    "<b>Reference</b> sends source files as they are, not flattened or cropped " +
    "to the frame. The model reads each one and composes the output itself, so " +
    "a reference can differ in shape from the output. Suits edit models such as " +
    "<i>Kontext</i>, <i>Klein</i> and <i>Qwen-Image</i>.<br><br>" +
    "Models that take a single input image generate at its size; Size shows when " +
    "that applies.<br><br>" +
    "A Reference frame can hold a grid of several images. Several inputs reach the " +
    "model together, numbered as the canvas shows them, on models that take more " +
    "than one image (<i>Qwen-Image 2.1</i>, <i>Qwen Edit Plus</i>, multi-image cloud " +
    "models). Once a model's limit is reached, the add buttons are greyed out.",
  control:
    "<b>Control</b> feeds its picture to a control model (ControlNet, T2I-Adapter, " +
    "XS, Lite or Style Transfer) that steers the generation by edges, depth, pose " +
    "or style. It is not one of the images the prompt can name.<br><br>" +
    "The frame composes one picture like Initial, laid out by its Fit; a processor " +
    "turns it into the map the model expects, or the frame can use another frame's " +
    "picture.",
  ipAdapter:
    "<b>IP-Adapter</b> sends its pictures as style or subject references to an " +
    "IP-Adapter model, which pulls the generation towards them. They are not " +
    "numbered images.<br><br>" +
    "Region masks, one per picture, confine each reference to part of the output.",
};

/** One line on what the role does. */
export const ROLE_SUMMARY: Record<FrameRole, string> = {
  initial: "Sends everything visible in the frame as one picture, at the output size.",
  reference: "Sends each picture as it is, uncropped.",
  control: "Feeds its picture to a control model; not an image the prompt can name.",
  ipAdapter: "Sends its pictures to an IP-Adapter as style or subject references.",
};
