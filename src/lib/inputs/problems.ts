// One fix per problem the outline reports: the frame list as the fix leaves
// it. Positions are those of the list the problem was computed from. The
// one problem fixed by running a job, `cloudMaps`, leaves the list as it is.

import { clearMaskObjects, clearStrokes, setEnabled, updateFrame } from "./reducers";
import type { OutlineProblem } from "./outline";
import type { Frame } from "./types";

/** Whether the problem's fix is a processing job rather than a change to the frames. */
export function fixRunsJob(problem: OutlineProblem): boolean {
  return problem.code === "cloudMaps";
}

function turnOff(frames: Frame[], positions: number[]): Frame[] {
  return positions.reduce(
    (list, position) =>
      updateFrame(list, frames[position - 1]?.id ?? "", (f) => setEnabled(f, false)),
    frames,
  );
}

/** A frame without the pictures and masks whose bytes are gone. */
function withoutUnreadable(frame: Frame): Frame {
  const pictures = frame.pictures.filter((p) => p.file !== null);
  const masks = frame.ipAdapter.masks.filter((p) => p.file !== null);
  return { ...frame, pictures, ipAdapter: { ...frame.ipAdapter, masks } };
}

export function fixProblem(frames: Frame[], problem: OutlineProblem): Frame[] {
  switch (problem.code) {
    case "tooManyImages": {
      // a composite past the limit takes its frame off; set pictures are hidden one by one
      if (problem.over.some((o) => o.pictureId === null)) return turnOff(frames, problem.positions);
      return problem.over.reduce(
        (list, o) =>
          updateFrame(list, o.frameId, (f) => ({
            ...f,
            pictures: f.pictures.map((p) => (p.id === o.pictureId ? { ...p, visible: false } : p)),
          })),
        frames,
      );
    }
    case "controlWithSet":
      return turnOff(frames, problem.positions);
    case "mixedControlTypes": {
      const keep = problem.frames[0]?.type;
      return turnOff(
        frames,
        problem.frames.filter((f) => f.type !== keep).map((f) => f.position),
      );
    }
    case "unreadable":
      return problem.positions.reduce(
        (list, position) => updateFrame(list, frames[position - 1]?.id ?? "", withoutUnreadable),
        frames,
      );
    case "maskWithSet":
      return problem.positions.reduce(
        (list, position) =>
          updateFrame(list, frames[position - 1]?.id ?? "", (f) =>
            clearMaskObjects(clearStrokes(f)),
          ),
        frames,
      );
    case "cloudMaps":
      return frames;
    case "tooLarge": {
      const gone = new Set(problem.pictures.map((p) => p.pictureId));
      return problem.positions.reduce(
        (list, position) =>
          updateFrame(list, frames[position - 1]?.id ?? "", (f) => ({
            ...f,
            pictures: f.pictures.filter((p) => !gone.has(p.id)),
            ipAdapter: { ...f.ipAdapter, masks: f.ipAdapter.masks.filter((p) => !gone.has(p.id)) },
          })),
        frames,
      );
    }
    case "ruleRefused": {
      // a set picture is hidden; a composite goes only with its frame
      const hidden = problem.pictures.reduce(
        (list, p) =>
          p.pictureId === null
            ? list
            : updateFrame(list, p.frameId, (f) => ({
                ...f,
                pictures: f.pictures.map((q) =>
                  q.id === p.pictureId ? { ...q, visible: false } : q,
                ),
              })),
        frames,
      );
      const composites = problem.pictures.filter((p) => p.pictureId === null);
      return turnOff(
        hidden,
        composites.map((p) => p.position),
      );
    }
  }
}
