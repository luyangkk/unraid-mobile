# Primary Tab Swipes and Transitions

Implement the user's reviewed task incrementally on the existing Router,
AppShell and shared Query lifecycle. The binding route order is Home `/`,
Docker `/docker`, VM `/vm`, Storage `/storage`.

## Architecture

Extract navigation destinations to `components/app/primaryNavigation.ts` without
importing the Router. BottomNavigation and an AppShell-owned gesture hook consume
it. Pointer state remains in refs; the current route comes from Router.

Use native Pointer Events scoped to the protected Shell lifecycle. Require
actual DOM containment in main or nav, including when React Portal events bubble.
AppSheet's existing overlay marker and a new content wrapper marker block starts
and completion until AnimatePresence removes the last Sheet DOM. Observe those
markers while a gesture is held so a briefly opened and closed Sheet also cancels it.
Do not lift disk selection or add a modal manager.

A stable main element contains one Outlet. Motion animates opacity only after
Router reports committed content; no keyed Shell, duplicated Outlet or retained
exit route. Router pending UI fills lazy chunk loading gaps. Existing LoadingPanel
continues handling data loading. No preload or dependency changes.

The supplied approach rules out horizontal page slides and a second exit tree.
A small dedicated hook keeps pointer lifecycle out of AppShell's data assembly.

## Gesture contract

- Touch only, primary single pointer; left goes next, right previous, no wrap.
- Recognize at 12px; horizontal requires `abs(dx) >= 1.5 * abs(dy)`. Lock direction.
- On release trigger at 60px, or 24px plus same-direction 600px/s. Velocity is the
  average from the pointer start; all values live in `tabMotion`.
- Exclude viewport edges within 24px, not max-width content edges.
- Cancel multiple pointers, pointercancel/lost tracking, route navigation,
  visibility changes, unmount and any Sheet DOM appearing. Check modality again
  before submission, before the Sheet window capture handler can remove it.
- Body excludes buttons, links, summary, inputs, editable and horizontal scrollers;
  bottom links allow touch starts. Preserve `pan-y pinch-zoom`.
- A recognized horizontal swipe consumes its generated nav click even at a route
  boundary. Match pointer identity and a bounded click window; ordinary subsequent
  pointerdown and keyboard click are unaffected.
- Router pending or an in-flight navigate promise rejects new swipe submissions.
  No queue; bottom links continue normal Router behavior.
- Header, status banners, PWA notices and unknown routes are not gesture entries.

## Motion and data

Opacity enters from 0.92 to 1 over 220ms on committed route changes, never first
mount, polling, metrics or stale changes. Reduced motion skips Tab animation but
keeps Tab swipes; Sheet's reduced-motion policy remains unchanged.
Bottom selection color transitions last 140ms.

Keep Home's three observers; detail routes own one each, 2s Docker/Storage and
3s VM. One System SSE, shared cache and CPU trend persist. 401/logout unmounts
listeners; no extra capabilities reads, offline business cache or API behavior.

## Verification

TDD uses real mountApp/Router and AppSheet. Cover direction thresholds and locking,
boundaries, nav click consumption, controls/edge/scroll/Portal exclusions, exit
modality, pending/history, activity/session cleanup, one SSE and observer counts.
Verify actual opacity and lazy pending behavior with production Chrome input.
Run npm ci, npm test, npm run build; attempt image build/smoke with available tools.
Physical Android, iOS and installed PWA acceptance remains separately recorded.
