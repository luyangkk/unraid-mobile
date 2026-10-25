# Sheet Right-Swipe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this focused fix. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close disk details after a deliberate right swipe inside AppSheet.

**Architecture:** Keep existing vertical drag and modal lifecycle. Add a shared
direction predicate and native pointer tracking scoped to an open sheet.

**Tech Stack:** React 19, TypeScript, Motion, Radix Dialog, Vitest/jsdom.

**Spec:** `docs/superpowers/specs/2026-10-25-sheet-right-swipe-design.md`

## Global Constraints

- Reuse current dependencies, queries, 100px/700px/s thresholds and reduced motion.
- Horizontal distance must exceed 1.5 × absolute vertical distance.
- Vertical content scrolling and pinch zoom remain browser-owned.
- Ignore controls/handle starts, canceled gestures and old held pointers.
- Use the existing dismissal path for focus restoration and scroll unlocking.

## Review Focus

- Vertical/diagonal motion must not close a scrolling sheet.
- Pointer cancellation and multi-touch must not close it.
- An old gesture must not affect a reopened sheet.
- Preference changes while a pointer is held must discard the gesture.
- Starts on buttons/links must retain their normal interaction.

### Task 1: Gesture correction and verification

**Files:** `web/src/components/app/AppSheet.tsx`, `AppSheet.test.tsx`,
`web/src/lib/motion.ts`, `motion.test.ts`, `README.md`, `AGENTS.md`.

**Interface:** `shouldDismissSheetSwipe(offsetX: number, offsetY: number,
velocityX: number): boolean`; AppSheet's public props remain unchanged.

- [x] Extend the real pointer-event helper to supply both coordinates and pointer ID.
- [x] Add a right-swipe close/focus/scroll test and direction/cancellation regressions.
- [x] Run focused Vitest tests and observe the missing right-swipe behavior fail.
- [x] Implement the predicate and guarded pointer handling; retain existing vertical drag.
- [x] Run focused tests, `npm ci`, `npm test`, `npm run build` and `git diff --check`.
- [x] Verify real pointer/touch gestures and scrolling using local production assets.
- [x] Obtain an independent review and resolve material findings with failing tests.
- [x] Replace stale Motion pan sessions; verify interleaved touch/mouse, exit state,
  velocity dismissal and second-finger cancellation.
- [x] Update the current interaction docs and record actual validation limits.
