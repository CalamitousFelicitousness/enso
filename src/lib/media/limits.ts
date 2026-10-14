// What the browser and the server can take, in pixels.

/** The largest canvas Chromium allocates (16384 x 16384); a send above it is
 * refused, since a canvas that fails to allocate draws nothing. */
export const CANVAS_CEILING_PIXELS = 16384 * 16384;
