# Tab direction lock correction

The deployed `d9298d3` build contains the expected Tab navigation and entry tokens.
Live Chrome touch input reproduces a false rejection: starting at `dx=12, dy=10`
immediately locks vertical, although the gesture later becomes clearly horizontal.

Keep the existing pointer, Router, modal and query lifecycle. At the 12px direction
threshold, lock horizontal only when `abs(dx) >= 1.5 * abs(dy)` and vertical only
when `abs(dy) >= 1.5 * abs(dx)`. An ambiguous diagonal remains undecided until an
axis clearly dominates. Pointer cancellation still ends the gesture; a genuine
vertical lock never becomes horizontal on release.
Cancellation and lost-capture events must match the held pointer before canceling
it. A different pointer's capture loss is a separate robustness regression; it
has not been observed on the user's iPhone.

Changing distances or simply lowering the ratio would not address the asymmetric
direction decision and could weaken scrolling protection. A native page carousel
would change the reviewed single-Outlet/no-page-follow contract and is outside
this focused correction.

TDD covers ambiguous starts in both horizontal directions and an ambiguous start
that becomes clearly vertical, plus unrelated pointer capture loss. Recheck the full app/Sheet suite, build/PWA policy
and built browser touch input. The original deployment remains unchanged; this
local correction is not represented as iPhone verification.

Live Chrome renders thirteen fade frames with minimum opacity around `0.928`.
The existing `0.92 → 1` entry is very subtle. The user's iPhone report of no visible
animation is not resolved by that evidence, and true native page-follow behavior
needs a separately agreed interaction change.
