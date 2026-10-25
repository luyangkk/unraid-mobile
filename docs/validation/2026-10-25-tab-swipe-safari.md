# Safari content-area Tab swipe fix

Date: 2026-10-25. User-reported environment: iPhone, Safari, iOS 27.0.1.
The user reports reliable bottom-navigation swipes but intermittent content-area
swipes. The reported iOS version has not been independently verified.

## Source inspection and research

`web/src/app/useTabSwipe.ts` tracks touch Pointer Events and navigates only on
`pointerup`. Both `main` and the fixed bottom navigation already declare
`touch-action: pan-y pinch-zoom`. A `pointercancel` discards the gesture.
There was no native `touchmove` listener to prevent a scroll takeover.

The content area participates in document scrolling; the bottom bar is fixed.
This makes scroll arbitration a plausible explanation for the reported difference.
It is a source-based diagnosis, not a captured trace from the user's iPhone.

Relevant primary sources:

- [WebKit issue 232545](https://bugs.webkit.org/show_bug.cgi?id=232545)
  describes horizontal gestures on `pan-y` elements turning into vertical page
  scrolling after small vertical movement. It was reported against Safari 15
  and remains marked NEW when consulted. That record does not establish whether
  the same bug affects iOS 27.0.1.
- [Pointer Events specification](https://w3c.github.io/pointerevents/#determining-supported-direct-manipulation-behavior)
  explains how `touch-action` determines native panning and zooming. Browser
  takeover suppresses the pointer stream. Changing `touch-action` after a gesture
  starts is too late for that gesture.
- [Touch Events specification](https://www.w3.org/TR/touch-events/#the-touchmove-event)
  describes preventing the first touchmove's default action to prevent scrolling.
  Waiting for the full navigation threshold can miss that opportunity.
- [WebKit issue 182521](https://bugs.webkit.org/show_bug.cgi?id=182521)
  explains root touch listeners becoming passive by default and the need for an
  explicit non-passive listener when canceling native scrolling.

There is a second, intentional source of non-response: starts on content buttons,
links, summaries, inputs, editable content and horizontal scrollers are excluded.
Header/status areas and the outer 24px of the viewport are also excluded.
This fix preserves those boundaries and the existing Sheet isolation.

## Change

Add a native capture `touchmove` listener with `passive: false` to `main` and
bottom navigation when the authenticated Shell mounts. Remove both listeners
when it unmounts. No global non-passive scroll listener or React state updates
are introduced.

For a valid single-touch gesture, reserve horizontal movement with
`preventDefault()` before Safari can turn it into scrolling. The first move can
be below the 12px direction-recognition threshold, so scroll arbitration checks
the horizontal ratio immediately; the navigation thresholds remain unchanged.
After horizontal recognition, continue reserving movement through vertical drift.
Vertical/ambiguous movement is left to the browser. A small initial horizontal
move can consequently reserve scrolling before a later vertical turn; this is
part of the direction arbitration that needs physical-device testing.

Multiple touches, non-cancelable native scrolling or a blocked Shell abandon the
gesture. Pointer Events remain the only navigation lifecycle; `pointercancel`
still cancels rather than being ignored or followed by a touchend navigation.
Keep `pan-y pinch-zoom`, existing release thresholds, control exclusions and
single-Outlet navigation/data subscriptions.

## Verification

- `npm ci`: passed; dependency manifests and lockfile unchanged.
- TDD: the new suite initially had four failing cases (main/nav native scroll
  reservation, multi-touch abandonment and non-cancelable scroll abandonment).
  All passed after the implementation change.
- `npm test`: 324 passed across 21 files, including ten new native-touch cases.
- `npm run build`: passed TypeScript, Vite and PWA verification. The existing
  main-chunk size advisory remains.
- Native Chrome CDP touch input: 17 checks passed, no page errors. This includes
  a swipe starting within scrolled content with later vertical drift: native
  touchmove was prevented, scrollY stayed fixed before release, and the route
  changed once. Vertical scrolling remained unprevented. See
  [browser results](2026-10-25-tab-swipe-safari-results.json).
- The first added browser case measured before the preceding vertical flick's
  inertia ended (scrollY 80 to 87). The script now waits for stable scroll frames
  before measuring the horizontal gesture; the complete rerun passed.
- `git diff --check`: passed.

Reproduce using the existing synthetic production-handler fixture on port 18081:

```sh
PLAYWRIGHT_MODULE=/tmp/unraid-primary-pages-check/node_modules/playwright/index.mjs \
  CHECK_REPORT_PATH=/tmp/unraid-tab-safari-results.json \
  node docs/validation/2026-10-25-tab-swipe/browser-check.mjs
```

No real Unraid data or host was used. No Go implementation or deployment changes
were made. At the time of the frontend verification above, Go tests/builds and
Docker image/deployment checks had not been run, and no commit, push or deployment
had been performed. The subsequent release request authorizes publishing this
development branch to GHCR, with full release checks recorded separately, without
merging into main or updating the Unraid host.

## Physical-device acceptance remains open

On the reported iOS 27.0.1 Safari, test each route's non-interactive content near
the top and after scrolling. Try slow and quick horizontal swipes with slight
vertical drift in both directions, including while Safari's toolbar is expanded
or collapsed. Check vertical scrolling and pinch zoom, native viewport-edge
navigation, ordinary bottom taps, and disk Sheet isolation. Controls and summary
headings should retain their existing interactions. Test any installed PWA
separately, after accepting the new static bundle through the existing update UI.

Neither synthetic events nor desktop Chrome's native touch emulation establishes
iPhone Safari compatibility. This change has not yet been tested on that device.
