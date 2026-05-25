// Layout result types for the multi-Input-frame stack. These describe what
// the layout engine (useControlFrameLayout) produces and what the Konva
// render layer (InputFrameLayer) consumes. All coordinates and sizes are in
// display units (canvas pixels x displayScale), matching the display-space
// convention used by ControlFrameLayer and OutputLayer.

/** Layout position of an Initial-mode Input frame. Pixel-space dims drive
 * flatten size; display-space drives Konva rendering. */
export interface InitialFramePosition {
  kind: "initial";
  frameId: string;
  /** Display-space top-left within the canvas Stage. */
  x: number;
  y: number;
  /** Pixel-space frame dimensions (the flatten target). For Initial frames
   * this is the generation size (gen.width x gen.height). */
  frameW: number;
  frameH: number;
  /** Display-space dimensions = frameW/H * displayScale. */
  displayW: number;
  displayH: number;
  /** 1-based global wire index when this frame contributes a slot to the
   * wire's images[] array. Null when the frame has no visible image layer
   * yet, in which case the UI shows "empty" rather than a number. */
  wireIndex: number | null;
}

/** One child cell inside a Reference mother frame's grid. Position is
 * display-space relative to the canvas Stage origin (not relative to the
 * mother) so the Konva render path can place each child at frame.x/y
 * without nested Group offsets. */
export interface ReferenceChildPosition {
  refId: string;
  x: number;
  y: number;
  displayW: number;
  displayH: number;
  /** 1-based global wire index of this reference child. Always populated
   * for children that appear in the layout. */
  wireIndex: number;
}

/** Layout position of a Reference-mode Input frame (the "mother frame
 * with grid of children" composition). The mother carries full chrome
 * (border, brackets, header); each child renders inside the mother as a
 * sub-cell with simpler chrome. */
export interface ReferenceFramePosition {
  kind: "reference";
  frameId: string;
  /** Display-space top-left of the mother frame. */
  x: number;
  y: number;
  /** Display-space mother dimensions. Width matches an Initial frame at
   * the same display scale; height grows with row count. */
  motherW: number;
  motherH: number;
  /** Per-child cell positions in render order. */
  children: ReferenceChildPosition[];
  /** Position of the trailing +Add cell, or null when the active model's
   * max_input_images cap is reached (UI hides the affordance at capacity). */
  addCellPosition: { x: number; y: number; w: number; h: number } | null;
  /** Wire index of the first child in this mother. Used by the panel
   * label ("Input 2 (Reference, 4 images)" where 2 is the first child's
   * wire index). Null when references is empty. */
  firstChildWireIndex: number | null;
}

/** Discriminated union the layout engine emits per Input frame, the Konva
 * render layer reads, and the DOM panel orchestrator iterates. Consumers
 * narrow via `kind` to access mode-specific fields. */
export type InputFramePosition = InitialFramePosition | ReferenceFramePosition;
