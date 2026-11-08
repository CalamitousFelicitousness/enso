import Konva from "konva";

let stopping = false;

/** True while `stopKonvaGestures` runs: a drag or transform end handler puts
 * its node back instead of saving where it went. */
export function interrupting(): boolean {
  return stopping;
}

/** Ends every Konva drag, ready or moving, and every transform in progress. */
export function stopKonvaGestures(stage: Konva.Stage): void {
  stopping = true;
  try {
    for (const tr of stage.find<Konva.Transformer>("Transformer")) {
      if (tr.isTransforming()) tr.stopTransform();
    }
    const { DD } = Konva;
    if (DD._dragElements.size > 0) {
      DD._dragElements.forEach((elem) => {
        elem.dragStatus = "stopped";
      });
      DD._endDragBefore();
      DD._endDragAfter(undefined);
    }
  } finally {
    stopping = false;
  }
  stage.batchDraw();
}
