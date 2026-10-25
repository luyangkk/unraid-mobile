import { expect, it } from "vitest";
import { shouldDismissSheet, sheetMotion } from "./motion";

it("dismisses only downward gestures beyond the shared offset or velocity thresholds", () => {
  expect(shouldDismissSheet(sheetMotion.dismissOffset + 1, 0)).toBe(true);
  expect(shouldDismissSheet(1, sheetMotion.dismissVelocity + 1)).toBe(true);
  expect(shouldDismissSheet(sheetMotion.dismissOffset, sheetMotion.dismissVelocity)).toBe(false);
  expect(shouldDismissSheet(40, 300)).toBe(false);
  expect(shouldDismissSheet(-150, -900)).toBe(false);
});
