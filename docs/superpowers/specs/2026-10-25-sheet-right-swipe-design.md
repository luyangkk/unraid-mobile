# Sheet Right-Swipe Dismissal

The user reports that swiping right after opening disk details does not close
them. AppSheet currently configures only handle-initiated `drag="y"`; no
horizontal dismissal handler exists.

Support an ordinary left-to-right gesture inside the panel, including its
scrolling body. Track native pointer starts and ends without translating the
panel horizontally. Keep vertical handle dragging, Radix focus/scroll lifecycle and
all read-only queries unchanged. This is an implementation choice for the
requested fix; native browser/OS history navigation is outside its scope.

Use the existing thresholds: rightward distance above 100px or rightward
average velocity above 700px/s. Require positive horizontal distance greater than
1.5 times the absolute vertical distance. Short slow, leftward, vertical,
pointer-canceled and stale gestures do not close. Ignore starts on interactive
controls and the vertical handle. Allow browser vertical scrolling and pinch
zoom with `touch-action: pan-y pinch-zoom`.

Clear the pending swipe on close, unmount, a new pointer and reduced-motion changes.
Only the matching pointer ID/type can end the gesture. Scope native listeners to
the open panel and keep its latest enabled state and close callback in refs so
exit-animation handlers and snapshot re-renders cannot reuse stale state.
Honor the current reduced-motion contract by disabling gesture dismissal. Return focus
to the disk row and release scroll locking through the existing close path.

Independent review reproduced Motion pan sessions surviving close/reopen and
preference changes: an old touch offset could dismiss a new sheet after a short
mouse gesture. Native pointer start/end tracking avoids that session reuse and
leaves browser scrolling untouched. Adding history entries would change routing
and would not cover ordinary in-panel swipes.

Verify with failing real-component pointer-event tests, direction/threshold
tests, the full frontend suite and production build, then browser pointer and
touch emulation. Physical iOS/Android and native edge-back gestures remain
separate device checks.
