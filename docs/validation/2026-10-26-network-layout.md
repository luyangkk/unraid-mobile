# Compact network layout validation

Date: 2026-10-26. Branch: `feat/network-interface-trends`.

## Result

The network interface selector is now a capsule in the Network title row.
It opens the shared AppSheet with native radio options, immediately dismisses
after selection and restores focus. Receive/Transmit numbers and plots align,
units use secondary text, graph placeholders reserve the same height as plots,
and network plots have a zero baseline. The footer preserves the sample's UTC
date/time and original RFC 3339 time attribute.

Selection, trend ownership, old-server compatibility and the single System
stream remain in the existing Shell. No host/API or theme palette changes.

## Verification

| Check | Observed result |
| --- | --- |
| `npm ci` | Completed without dependency changes |
| TDD | Updated panel and integration tests first failed for the missing selector; implementation passed them |
| Final `npm test` | 459/459 tests passed across 33 files |
| `npm run build` | TypeScript, Vite and PWA build checks passed; 12 static precache entries |
| Chrome production layout | Dark/Light at 320, 390 and 448px passed containment and alignment checks |
| Interface button | Header and control measured 44px high at all checked widths |
| Network plots | Both plots measured 48px high with matching top positions |
| Chrome interaction | Both themes passed point selection, immediate dismissal, focus return, Escape, full wrapping names, trigger truncation, CPU retention and single SSE |
| Impeccable detector | Changed UI files returned `[]` |
| `git diff --check` | Passed |

Integration tests cover a disappeared selected interface while the sheet is
open, theme updates preserving the dialog and focused radio, unavailable Auto
with readable manual interfaces, current-choice dismissal without clearing
curves, and removal of an open sheet when System collection becomes unavailable.
Existing tests continue to cover background/offline behavior, session resets and
old-server Auto.

Two early full-suite runs failed the first existing lazy-route gesture test,
while the file passed alone. Its setup now waits for the Docker page before
sending the gesture; all original scrolling/navigation assertions remain.
The final unfiltered full-suite run passed.

Final code review was performed by the author as a separate pass because the
session exposed no subagent tool. No material unresolved finding was identified;
this was not an independent review.

Installation reported the existing five dependency audit findings. The build
retains its existing main-chunk size warning. Dependencies were not upgraded.

## Browser evidence and limits

The browser used the actual production build with a temporary local synthetic
API/SSE, with no host access. Synthetic sample timestamps advanced for testing;
these checks establish layout and interaction, not host rate accuracy.

- [Browser results](2026-10-26-network-layout/browser-report.json)
- [Dark 320px](2026-10-26-network-layout/dark-320.png)
- [Light 320px](2026-10-26-network-layout/light-320.png)
- [Dark interface sheet](2026-10-26-network-layout/dark-sheet-320.png)
- [Light interface sheet](2026-10-26-network-layout/light-sheet-320.png)

No Android/iOS device or installed-PWA acceptance was performed. Go, container
and deployment checks were not run for this frontend-only change. No deployment,
push or commit was performed.
