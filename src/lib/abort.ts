/** Ends an action the user stopped, or one whose caller already said why it
 * cannot run, without a generic failure toast after it. */
export class UserAbortError extends Error {
  override name = "UserAbortError";
}
