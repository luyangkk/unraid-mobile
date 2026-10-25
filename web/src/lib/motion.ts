import { useSyncExternalStore } from "react";

export const tabMotion = {
  directionOffset: 12,
  directionRatio: 1.5,
  dismissOffset: 60,
  flickOffset: 24,
  flickVelocity: 600,
  viewportEdge: 24,
  clickWindow: 700,
  displacement: 32,
  exit: { duration: 0.18 },
  nativeEnter: { duration: 0.24 },
  enter: { duration: 0.22 },
  ease: [0.22, 1, 0.36, 1] as const,
  captureBudget: 350,
  activeColor: 0.14,
};

export const sheetMotion = {
  dismissOffset: 100,
  dismissVelocity: 700,
  swipeDirectionRatio: 1.5,
  fade: { duration: 0.18 },
  reduced: { duration: 0 },
  spring: { type: "spring", stiffness: 400, damping: 38 } as const,
};

// shouldDismissSheet accepts only a sufficiently large or fast downward gesture.
export function shouldDismissSheet(offset: number, velocity: number): boolean {
  return offset > sheetMotion.dismissOffset || velocity > sheetMotion.dismissVelocity;
}

// shouldDismissSheetSwipe rejects leftward and vertically dominated pan gestures.
export function shouldDismissSheetSwipe(offsetX: number, offsetY: number, velocityX: number): boolean {
  return offsetX > 0
    && offsetX > Math.abs(offsetY) * sheetMotion.swipeDirectionRatio
    && shouldDismissSheet(offsetX, velocityX);
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
