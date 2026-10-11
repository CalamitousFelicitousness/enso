import { uploadFailureText, type UploadFailure } from "./text";

/** Why an upload did not land, worded for a toast. */
export class UploadRefused extends Error {
  override name = "UploadRefused";
  readonly failure: UploadFailure;
  constructor(failure: UploadFailure, options?: ErrorOptions) {
    super(uploadFailureText(failure), options);
    this.failure = failure;
  }
}
