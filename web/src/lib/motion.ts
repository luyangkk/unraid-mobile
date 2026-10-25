import { useSyncExternalStore } from "react";

export const sheetMotion = {
  dismissOffset: 100,
  dismissVelocity: 700,
  fade: { duration: 0.18 },
  reduced: { duration: 0 },
  spring: { type: "spring", stiffness: 400, damping: 38 } as const,
};

// shouldDismissSheet accepts only a sufficiently large or fast downward gesture.
export function shouldDismissSheet(offset: number, velocity: number): boolean {
  return offset > sheetMotion.dismissOffset || velocity > sheetMotion.dismissVelocity;
}

// subscribeReducedMotion tracks preference changes even while a sheet is open.
function subscribeReducedMotion(listener: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

// reducedMotionSnapshot reads the preference without caching browser state.
function reducedMotionSnapshot() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// useReducedMotion shares the live preference without introducing a state store.
export function useReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, reducedMotionSnapshot, () => false);
}
