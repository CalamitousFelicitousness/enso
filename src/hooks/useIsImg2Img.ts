import { useInputStore } from "@/stores/inputStore";
import { outlineOf } from "@/inputs/useOutline";

export function useIsImg2Img() {
  return useInputStore((s) => outlineOf(s.frames).sent.some((input) => input.role === "initial"));
}
