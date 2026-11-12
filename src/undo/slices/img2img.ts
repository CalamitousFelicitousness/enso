// Size mode and mask options of the Images view.

import { useImg2ImgStore } from "@/stores/img2imgStore";
import { keySlice } from "../slice";

type Img2Img = ReturnType<typeof useImg2ImgStore.getState>;

const KEYS = [
  "resizeMode",
  "sizeMode",
  "scaleFactor",
  "megapixelTarget",
  "resizeMethod",
  "autoSize",
  "maskBlur",
  "inpaintFullRes",
  "inpaintFullResPadding",
  "inpaintingMaskInvert",
  "maskApplyOverlay",
] as const satisfies readonly (keyof Img2Img)[];

export const img2imgSlice = () =>
  keySlice({
    name: "img2img",
    scope: "images",
    store: useImg2ImgStore,
    keys: KEYS,
    set: (values) => useImg2ImgStore.setState(values as Partial<Img2Img>),
  });
