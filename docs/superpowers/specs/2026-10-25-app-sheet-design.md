# AppSheet and Disk Details Design

## Intent and scope

Replace inline Storage disk details with an accessible bottom sheet consuming
the current read-only snapshot. Home retains capacity summaries only. No API,
polling, host access, write capability, route state, or offline data changes.

## Approach

Use Radix Dialog for modality, focus containment, dismissal and scroll locking;
use Motion for appearance and handle-only downward dragging. Native dialog would
require additional gesture and focus lifecycle work; a larger drawer library
would add an unplanned dependency. These are implementation choices within the
provided task specification.

`components/ui/sheet.tsx` owns Radix primitives. `components/app/AppSheet.tsx`
owns presentation and interaction. Features import only AppSheet. Shared
transitions and dismissal thresholds live in `lib/motion.ts`.

## Interface and interaction

AppSheet accepts `open`, `onOpenChange`, `title`, `description`, `children`,
optional `footer`, and optional `returnFocusRef`. The explicit ref handles mobile
browsers that do not focus a tapped button. Without it AppSheet remembers the
focused element at opening.

The panel sits at the viewport bottom, centered at at most 28rem, with a shaded
overlay, a 44px close button, safe-area padding and an independently scrolling
body. Header/handle/footer remain outside the scrolling area. Dialog heading and
description label the modal. Radix contains Tab focus and supports Escape.
Dismissal restores the connected trigger; a missing disk uses the Disks summary
as its focus fallback.

Only the handle initiates a vertical drag. A downward offset above 100px or
downward velocity above 700px/s dismisses; lesser gestures spring back. Reduced
motion disables dragging and translation, using a short opacity transition.

## Storage integration

StoragePanel holds only a selected disk name and the trigger ref. It resolves
that name against `snapshot.disks` on every render. Clickable disk rows retain
name, role, total capacity, temperature and textual power state. Full metadata
and rates move into DiskDetailSheet, which consumes props and performs no reads.

Disk details show used/free/total capacity (size fallback for total only),
temperature, filesystem/state, rates, device exactly as supplied by the API,
power state, role and RFC3339 sample time. Existing byte/rate formatters remain
authoritative. Standby suppresses temperature even if an inconsistent snapshot
contains one. Missing fields use `—`; missing capacities do not imply zero.

Stale/error treatment and timestamp follow the incoming panel props. New
snapshots update an open sheet. A missing selected disk clears visible details
and displays “磁盘已不在最新快照中”; the sheet remains dismissible. Unavailable
collection snapshots likewise do not present previous details as current.

## Verification

Use failing Vitest tests before behavior changes, covering dialog semantics,
dismissal, focus/scroll lifecycle, footer, gestures and reduced motion; disk
formatting, identity, live updates, disappearance and freshness; real app fetch
counts and unchanged two-second polling. Run the requested web, Go and image
checks. Browser checks cover narrow layout, keyboard and pointer/touch gestures.
Document physical Android/iOS and real host checks as unverified unless executed.
