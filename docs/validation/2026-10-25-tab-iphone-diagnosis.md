# Deployment and reported iPhone Tab gesture diagnosis

Date: 2026-10-25. Target: `http://10.0.0.66:18080`.
Deployed change: `d9298d3`. Local correction branch:
`fix/tab-swipe-direction-lock`.

## Verified deployment

The image workflow for `d9298d3` completed successfully:
<https://github.com/luyangkk/unraid-mobile/actions/runs/40169217495>.

The deployed page loads `/assets/index-Ba4O_zDn.js`. Its bundle contains the
expected direction, flick, viewport-edge and entry tokens, the `onRendered`
subscription, and retained Sheet content marker. No container image digest
was inspected; these checks establish the shipped frontend behavior.

At approximately 14:44 UTC+8, `/healthz` returned 204. System, Docker, VM and
Storage returned 200 with `available=true`; the snapshots contained 25 containers,
one VM and six disks. No host setting, resource state or deployment was changed.

All four rendered page headings matched the URL and selected navigation item
after content settled. No horizontal overflow occurred at 390px. Cycling between
pages created zero additional System SSE requests. No page JavaScript errors
were observed.

## Reproduced gesture failure

Chrome's native touch input at the real deployment reproduced:

| Gesture from Docker | Deployed result | Corrected local result |
|---|---|---|
| Horizontal touch from a heading, ending at -100px | VM | VM |
| First move -12px horizontally, +10px vertically; then -100px, +10px | Stays on Docker | VM |
| Clearly vertical start, followed by horizontal movement | Stays on Docker; pointer canceled by scrolling | Same |
| Horizontal touch starting on bottom Storage link | VM, not Storage | Same |
| Horizontal touch starting on a summary control | Stays on Docker | Same |

The failed ambiguous-start gesture delivered pointerdown, pointermove and
pointerup without cancellation. The implementation assigned every non-horizontal
first move to vertical, including movements with no clear dominant axis.
That decision persisted after the gesture became horizontal.

The local correction leaves ambiguous movements undecided and locks vertical
only when vertical displacement has the same 1.5-times dominance required for
horizontal locking. Existing scrolling cancellation, controls, edge exclusion,
modal isolation and Router pending behavior remain in effect.

Independent code diagnosis also found that capture loss from an unrelated
pointer canceled a held touch. A failing regression now proves cancellation
must match the held pointer. This robustness gap was not observed on the iPhone.

## Animation and native behavior

The deployed browser rendered 13 entry frames with opacity starting around
0.928 and ending at 1. The configured range is only `0.92 → 1` over 220ms.
This is a subtle entry fade after release; the page does not follow the finger.
Starting on controls or within viewport edges intentionally does not initiate
Tab navigation. These differences can also make the interaction feel unlike
a native page carousel.

Chrome evidence does not establish why the user's iPhone shows no visible
animation. iPhone Safari, installed PWA, the user's reduced-motion preference
and its actual click/pointer sequence were not inspected. A reduced-motion
preference deliberately disables the fade. The tested LAN HTTP endpoint is
not a PWA secure context; the user's actual entry URL was not established.

Changing to page-follow and snap behavior would change the reviewed
single-Outlet/no-horizontal-slide interaction contract. The local fix keeps the
existing fade and does not claim to resolve that design mismatch.

## Local correction verification

- TDD: both ambiguous-start direction cases failed before the correction.
  Unrelated capture loss also failed before matching pointer identity.
- Full `npm test`: **314 passed across 21 files**, including the existing
  Home polling, route cache/SSE, Sheet gesture/focus and session regressions.
- `npm run build`: TypeScript, Vite and PWA checks passed. The existing main-chunk
  size advisory remains.
- Native Chrome input against locally built assets at `127.0.0.1:18081` passed
  the five gesture cases above and rendered the fade on the repaired gesture.
  That local handler uses synthetic readers, not a real Unraid host.
- A pre-existing diagonal test was corrected to retain its diagonal release
  coordinates: it previously moved diagonally and silently released horizontally.

Temporary input scripts and raw pointer traces are kept outside the repository.
At the time of diagnosis, the code correction was uncommitted, unpushed and
undeployed. The subsequent release request authorizes publishing this development
branch to GHCR without merging into main or updating the Unraid host. Image
publication is verified separately from this diagnosis. Physical iPhone acceptance
of the correction has not been performed.
