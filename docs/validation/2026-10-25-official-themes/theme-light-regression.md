# Production Tab Transition Browser Acceptance

- Run: 2026-10-25T10:43:26.809Z
- URL: http://127.0.0.1:18189/
- Chrome: 155.0.8059.86
- Node: v24.2.0
- Playwright module: /tmp/unraid-primary-pages-check/node_modules/playwright/index.mjs
- Summary: 22 passed, 0 failed, 129 assertions
- The configured local server serves production files; API fixtures and faults are synthetic.

## Checks

| Check | Result | Evidence |
| --- | --- | --- |
| appearance: Both palettes preserve pages, Portal focus and 320px header controls | passed | appearance.json |
| appearance-session: Authentication and offline cold startup use both saved palettes | passed | appearance-session.json |
| appearance-transition: System palette changes cancel a native snapshot and retain committed navigation | passed | appearance-transition.json |
| native-home-docker: Adjacent native old/new live direction and one real route | passed | native-home-docker.json |
| native-docker-home: Adjacent native old/new live direction and one real route | passed | native-docker-home.json |
| native-docker-vm: Adjacent native old/new live direction and one real route | passed | native-docker-vm.json |
| native-vm-docker: Adjacent native old/new live direction and one real route | passed | native-vm-docker.json |
| native-vm-storage: Adjacent native old/new live direction and one real route | passed | native-vm-storage.json |
| native-storage-vm: Adjacent native old/new live direction and one real route | passed | native-storage-vm.json |
| bottom-interruption: Bottom click interrupts native visuals; busy swipes are ignored | passed | bottom-interruption.json |
| slow-chunk: Real lazy chunk delayed beyond 350ms: pending, no frozen snapshot, one navigation | passed | slow-chunk.json |
| motion-forward: Native missing: real directional Motion entry frames | passed | motion-forward.json |
| motion-backward: Native missing: real directional Motion entry frames | passed | motion-backward.json |
| reduced-dynamic: Dynamic reduced-motion interrupts native and still permits touch navigation | passed | reduced-dynamic.json |
| width-320: 320px native and fallback have no horizontal overflow | passed | width-320.json |
| geometry-long-short: Long/short natural snapshot ratios, no group resize, snapshots stay above nav | passed | geometry-long-short.json |
| data-details-no-replay: SSE refresh, REST refresh, and details expansion never replay route entry | passed | data-details-no-replay.json |
| blank-gap-gestures: VM true blank area and Storage bottom spacing accept native touch swipe | passed | blank-gap-gestures.json |
| rotation-during-capture: Viewport rotation during delayed capture falls back without displacement | passed | rotation-during-capture.json |
| scroll-geometry: Scrolled old page to top-restored new page uses opacity-only geometry fallback | passed | scroll-geometry.json |
| deadline-then-resize: Deadline-suppressed pending navigation stays neutral through repeated resize | passed | deadline-then-resize.json |
| endpoints-same-route: Endpoint swipes and same-tab activation do not navigate or animate | passed | endpoints-same-route.json |

## Failures

## Browser Errors

```json
[]
```

## Limitations

- Desktop Chrome automation does not validate iPhone Safari, installed PWA, or a real Unraid host.
- Playwright fulfill cannot stream SSE. Only /events is redirected by route.continue to this script's temporary synthetic streaming server; all REST fixtures are returned directly by route.fulfill.
- Snapshot content is checked by separate old/new screenshots plus before/after semantic DOM evidence; screenshot pixel differences alone are not OCR.
- Real hidden/visible lifecycle remains unverified: headless and headed local Chrome, tab activation, window minimization, Page.setWebLifecycleState, and disabled CDP focus emulation all retained visible. No fabricated visibility events are used. See visibility-probe.json.
- No npm ci, application unit tests, build, Go tests, or image checks are performed by this browser-only script.

## Repeat

```sh
PLAYWRIGHT_MODULE=/tmp/unraid-primary-pages-check/node_modules/playwright/index.mjs \
CHECK_BASE_URL=http://127.0.0.1:18183 node web/scripts/verify-tab-transition.mjs
# Without PLAYWRIGHT_MODULE, the script resolves the existing local playwright package.
# From web/: node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 18183 --strictPort
# CHECK_BASE_URL, PLAYWRIGHT_MODULE, CHROME_EXECUTABLE, CHECK_REPORT_PATH, CHECK_THEME are supported.
# CHECK_REPORT_PATH must remain under /tmp/unraid-tab-transition-browser/.
```
