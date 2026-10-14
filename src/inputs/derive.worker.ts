// Worker host for derivePicture. Uses only globals the DOM lib also declares,
// so it type-checks in the app project without the WebWorker lib.

import { derivePicture, type DeriveInput } from "./deriveCore";

export interface DeriveRequest {
  jobId: number;
  input: DeriveInput;
}

export type DeriveResponse =
  | { type: "derived"; jobId: number; blob: Blob }
  | { type: "error"; jobId: number; message: string };

addEventListener("message", (event: MessageEvent<DeriveRequest>) => {
  const { jobId, input } = event.data;
  derivePicture(input).then(
    (blob) => postMessage({ type: "derived", jobId, blob } satisfies DeriveResponse),
    (err: unknown) =>
      postMessage({
        type: "error",
        jobId,
        message: err instanceof Error ? err.message : String(err),
      } satisfies DeriveResponse),
  );
});
