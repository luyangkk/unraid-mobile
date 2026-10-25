# Tab swipe blank-area coverage

Date: 2026-10-25. Follow-up to the Safari gesture fix at `5e5a46f`.
The user clarified that iPhone swipes work on cards but fail outside cards.

## Reproduced cause

`useTabSwipe` accepts starts within `main` or bottom navigation. AppShell's
outer wrapper had a viewport minimum height, but `main` only had content height.
On short pages, the blank area below a card therefore belonged to the wrapper,
outside both the gesture listener and its `pan-y pinch-zoom` surface. The wrapper
also owned the spacing immediately above the fixed navigation.

The added native Chrome test failed against the previous production build:
swiping left at the midpoint between an unavailable VM card and navigation left
the route at `/vm`; the expected `/storage` route timed out. The captured pointer
target was the outer AppShell `div`. This test intentionally uses blank-screen
coordinates rather than the old test helper that searched for eligible content.

## Fix and verification

Make AppShell a vertical flex container and let `main` grow into the unused
viewport space. Reserve 4rem plus the bottom safe area for navigation in the
wrapper; put the existing remaining 2rem content spacing inside `main` as bottom
padding. The overall content clearance remains 6rem plus the safe area, while
the whitespace above navigation becomes part of the gesture surface.

No gesture thresholds, control exclusions, modal behavior, data subscriptions,
dependencies or backend code changed. Header controls and viewport-edge gestures
retain their existing boundaries.

- `npm ci`: passed; lockfile unchanged.
- `npm test`: 324 passed across 21 files.
- `npm run build`: TypeScript, Vite and PWA checks passed; the existing bundle
  size advisory remains.
- Native Chrome input: 19 checks passed without page errors. New cases cover
  unavailable and empty VM pages swiped from blank space into Storage, then a
  right swipe from Storage's gap immediately above navigation back into VM.
  Existing vertical-scroll, Sheet, routing and 320px checks passed too.
- `git diff --check`: passed.

Layout coverage uses actual browser hit testing because jsdom does not calculate
element dimensions. Results are in
[the browser report](2026-10-25-tab-swipe-blank-area-results.json). Run the existing
browser script with `CHECK_REPORT_PATH` to preserve earlier reports.

The browser used a local synthetic API fixture and production frontend build.
At the time of that verification, this revision had not been committed or deployed,
and Go and image checks had not been run. The subsequent release request authorizes
publishing the development branch to GHCR with full release checks recorded
separately, without merging into main or updating the Unraid host.
Physical iPhone acceptance remains unverified.
