# Sheet Right-Swipe Validation — 2026-10-25

The disk-details right-swipe defect is reproduced and corrected locally.
AppSheet previously enabled only handle-initiated vertical dragging. A right
swipe in the content had no dismissal handler.

The fix recognizes predominantly horizontal right swipes using native pointer
tracking and the shared distance/velocity thresholds. It uses the existing
modal close path, retaining focus restoration and scroll unlocking. Controls
and the vertical handle do not initiate horizontal dismissal. Pointer
cancellation, left/vertical/short slow gestures, reduced motion and old held gestures
do not close the panel.

## Verification

- Baseline: the existing AppSheet/motion suites passed 10 tests.
- Red: a real-component 140px body swipe left the dialog open. The new direction
  predicate's 10 cases also failed before implementation.
- Red in Chrome: the same right swipe against the old production frontend
  timed out waiting for the dialog to close.
- Review red: interleaved old touch/new mouse gestures after close/reopen and
  preference changes incorrectly closed the panel in both cases. A swipe during
  the exit animation also requested a second dismissal.
- Review green: all three cases passed after replacing Motion pan sessions with
  native pointer tracking, open-state guards and listener cleanup. Fast flicks
  and second-finger cancellation also have real-component coverage.
- Green: `npm test` passed all **269 tests across 21 files**.
- `npm ci` passed; no package or lockfile change was made.
- `npm run build` passed, including the existing PWA artifact and cache-boundary
  checks.
- `git diff --check` passed.

The focus regression waits until presence removal and Radix's deferred close
autofocus have both completed. The real Chrome checks independently confirm
that the disk row receives focus after a swipe.

## Production-build browser checks

Used local desktop Chrome and Android Chrome touch emulation with production
frontend assets served by the existing Go handler and synthetic readers:

- Right pointer swipe closes the dialog and restores row focus/scrolling.
- Short, leftward, vertical and diagonal pointer gestures keep it open.
- Existing downward handle dragging still closes it.
- Right touch swipe closes and restores focus/scrolling.
- Canceled touch swipe keeps the dialog open.
- Vertical touch gesture scrolls only the detail body and does not dismiss.
- Reduced motion disables swipe dismissal while Escape remains usable.
- No JavaScript page errors were observed.

All ten browser checks were rerun against the final production build
(`index-C324L0bR.js`) and passed.

Browser contexts used 390px and 320px viewports. Intermediate scripts and JSON
evidence remain under `/tmp`; no test fixtures were added to the production
request chain. No real host request, resource action or deployment was performed.

## Limits

Physical Android/iOS interaction and native browser/OS edge-back gestures remain
unverified. The fix covers ordinary in-panel right swipes, not browser history.
Go tests, image build and image smoke checks were not rerun for this frontend-only
change. The build retains the existing main-chunk size warning; `npm ci` reports
five existing dependency audit findings. Dependencies were not upgraded.

These checks cover the local frontend. Deployment and real-device acceptance
on `10.0.0.66` require separate verification.
