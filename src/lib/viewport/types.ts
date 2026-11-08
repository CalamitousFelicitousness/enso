// The geometry a canvas camera works in. Screen points are CSS pixels from
// the canvas container's top-left; world points are the layout's display
// units. A viewport maps world to screen: screen = world * scale + (x, y).

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Box extends Point, Size {}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}
