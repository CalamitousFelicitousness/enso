/** The canvas holds inputs the loaded model or the browser cannot take as they are. */
export class InputRefusal extends Error {
  override name = "InputRefusal";
}
