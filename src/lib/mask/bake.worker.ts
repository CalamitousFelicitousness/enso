// Dedicated worker host for bakeMasks. Uses only globals the DOM lib also
// declares (addEventListener, postMessage with a transfer list), so it
// type-checks in the app project without the WebWorker lib.

import { bakeMasks } from "./bakeCore";
import type { BakeRequest, BakeResponse } from "./protocol";

addEventListener("message", (event: MessageEvent<BakeRequest>) => {
  const req = event.data;
  if (req.type !== "bake") return;
  bakeMasks(req.input).then(
    (output) => {
      const res: BakeResponse = { type: "bake", jobId: req.jobId, output };
      postMessage(res, { transfer: [...new Set(output.regions.map((r) => r.bitmap))] });
    },
    (err: unknown) => {
      const res: BakeResponse = {
        type: "error",
        jobId: req.jobId,
        message: err instanceof Error ? err.message : String(err),
      };
      postMessage(res);
    },
  );
});
