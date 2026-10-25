import { expect, it } from "vitest";
import { shouldDismissSheet, shouldDismissSheetSwipe, sheetMotion } from "./motion";

it("dismisses only downward gestures beyond the shared offset or velocity thresholds", () => {
  expect(shouldDismissSheet(sheetMotion.dismissOffset + 1, 0)).toBe(true);
  expect(shouldDismissSheet(1, sheetMotion.dismissVelocity + 1)).toBe(true);
  expect(shouldDismissSheet(sheetMotion.dismissOffset, sheetMotion.dismissVelocity)).toBe(false);
  expect(shouldDismissSheet(40, 300)).toBe(false);
  expect(shouldDismissSheet(-150, -900)).toBe(false);
});

it.each([
  [101, 0, 0, true],
  [40, 10, 701, true],
  [100, 0, 700, false],
  [40, 10, 300, false],
  [-150, 0, -900, false],
  [-10, 0, 900, false],
  [0, 0, 900, false],
  [140, 150, 900, false],
  [150, 100, 0, false],
  [151, 100, 0, true],
])("right swipe (%s, %s) at %s px/s dismisses: %s", (x, y, velocity, expected) => {
  expect(shouldDismissSheetSwipe(x, y, velocity)).toBe(expected);
});
