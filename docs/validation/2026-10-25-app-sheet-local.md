# AppSheet Local Validation — 2026-10-25

AppSheet and read-only disk details pass local automated and production-browser
checks. Physical Android/iOS behavior and Docker image verification remain
unverified.

## Automated verification

- `npm ci`: passed after adding only Radix Dialog and Motion. A lockfile comparison
  confirms every pre-existing package retains its version, including Radix Slot.
- `npm test`: 21 files, **243 tests passed**.
- `npm run build`: passed, including PWA artifact checks, all route chunks and
  the existing network-only API/health/SSE/credential boundaries.
- `go test -race ./...`: passed.
- `go build ./cmd/server` and `go build ./cmd/host-spike`: passed; output binaries
  were directed to `/tmp`.
- Unraid XML parse and `git diff --check`: passed.
- `docker build -t unraid-mobile:local .`,
  `sh scripts/verify-image.sh unraid-mobile:local`, and `docker compose config`:
  attempted but failed because the Docker command is unavailable.

The build reports a JS chunk-size warning: main JS is approximately 622 kB
minified, 199 kB gzip. Dependency additions are included in the shared page
bundle; no unrelated dependency upgrade or bundler reconfiguration was made.
`npm ci` also reports the existing audit findings; dependency upgrades were
outside this task.

## TDD and regressions

- Initial AppSheet suites could not import the missing modules. After adding
  them, the modal test failed on missing explicit `aria-modal`; that was fixed.
- Eight disk interaction tests failed on missing row buttons and standby
  temperature suppression before Storage implementation. Three static list
  tests failed before replacing inline detail fields with row summaries.
- Tests cover field formatting/unknowns, standby, disk identity after reordering,
  live snapshot updates, removed disks, collection unavailability, stale/errors,
  sample time, modal dismissal/focus/scroll lifecycle and Home exclusions.
- Real routed integration verifies no additional fetch on opening/closing,
  exactly three Storage reads in six seconds, live details after polling and
  offline/failed-refresh treatment. Query hooks and polling intervals are unchanged.
- Real browser dragging first failed because only content moved. The draggable
  surface now includes the full panel, while a separate frame handles entrance/exit.
- Independent review found held gestures affecting a reopened sheet,
  `pointercancel` dismissing, and trigger removal during exit losing focus.
  Each was reproduced in regression tests before its fix. Motion controls now
  cancel on close/preference change/unmount, old callbacks are ignored, cancellation
  springs back, and the focus target follows snapshot removal through exit.
  The focus test waits for Radix's deferred post-unmount focus restoration.
- Focused independent re-review found no remaining Important/Critical issues in
  the three fixes or their regression coverage.

## Production-browser checks

Used local Chrome with disposable contexts, the production Go frontend handler
serving `web/dist`, and synthetic read-only host/container/VM fixtures. Browser
scripts, screenshots, binaries and intermediate JSON remain under `/tmp`.

- Whole-panel handle drag, a short downward drag snapping back, distance
  dismissal and fast downward velocity dismissal passed.
- Tab/Shift+Tab focus stays inside; Escape, overlay and close button dismiss;
  focus returns to the disk row. Open-modal background scrolling remains locked.
- 320px width: no document/detail horizontal overflow, independent detail
  scrolling, 44px square close target, stable header and background scroll.
  The screenshot was visually inspected.
- iPhone viewport emulation: 390px width and CDP-injected 34px bottom safe area;
  computed panel padding is 34px, with independent scrolling and 44px close target.
- Android Chrome viewport/touch emulation: 412px width, successful row tapping,
  touch swipe dismissal and trigger focus restoration. A bounding-box measurement
  of 43.999984px corresponds to the 44px CSS target.
- Reduced-motion preference disables handle dragging and translation; a drag
  cannot move/dismiss the panel, while Escape remains usable.
- No browser JavaScript errors were observed.

## Remaining checks

Physical Android Chrome and iOS Safari, real notches/Home Indicator, OS gesture
cancellation, installed PWA interaction and real Unraid host observation were
not performed. Use README's manual checklist. Observe existing read-only data;
never wake a standby disk to validate its temperature display.

No Storage API, host reader, production permission, write capability, polling
interval, URL/localStorage selection, or offline business cache was added or
changed. No deployment or push was performed.
