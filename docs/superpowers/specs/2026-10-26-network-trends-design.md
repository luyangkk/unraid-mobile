# Network interface selection and live trends

## Intent and scope

Implement the user's 2026-10-26 network display specification in the existing
System panel. Docker action Spike work is deferred. Preserve all read-only
boundaries, authentication, caching and single System stream ownership.

## Approach

Read all interfaces once from mounted `proc/1/net/dev` in each one-second System
sample. Select Auto independently from mounted `proc/1/net/route`, using the
active default IPv4 route with the lowest metric. Calculate rates independently
in the app service, then project the Auto result onto the three legacy fields.
The browser chooses a single interface; it never changes host configuration.

Keeping only Auto cannot support comparison with native Dashboard. Separate
per-interface requests would duplicate sampling and streams. Extending the
existing complete snapshot provides both without changing request lifecycles.
These choices follow the supplied specification.

## Backend contract

Add `networkInterfaces: NetworkInterfaceSnapshot[]` to REST and SSE snapshots.
Each item has `name`, `available`, optional `reason`, nullable
`rxBytesPerSecond` and `txBytesPerSecond`. Emit an empty array when no counters
are readable, and retain malformed named rows as unavailable. Sort names
lexicographically for stable ordering. Route failure does not discard readable
interfaces or make the System unavailable.

Maintain adjacent timestamped baselines per interface. First samples, additions,
counter rollback and recovery have null rates; valid unchanged counters produce
zero. Removal or local failure resets only that interface. Whole reader failure
resets all baselines. Auto fields come from that same calculation.

Attempt to read `sys/class/net/<name>/ifindex` through the existing sysfs mount.
An observed identity change or loss/recovery of identity resets the baseline.
Ifindex can be reused and sysfs may not expose the same network namespace:
do not claim reliable identification of all same-name replacements. No MAC/IP
metadata is exported. Defensively copy the array, pointer values and existing
optional metrics at every cache/subscriber boundary.

## Browser state and presentation

Extend `useSystem`, owned by persistent AppShell, with an in-memory selection
(`null` means Auto) and selected-interface network points. Changing selection
or Auto's resolved name resets network points and seeds from the current
snapshot. Selection persists across tabs, disappears on session unmount and
reload, and is retained with an unavailable option if its interface disappears.
Old servers without the new array still support Auto via legacy fields.

Network points contain a server timestamp and nullable RX/TX. Reject duplicate,
invalid and out-of-order timestamps; retain at most 60 points in the latest
60-second window. Null values split each direction independently. A gap greater
than 3 seconds also splits paths; configure limits in one place. Do not fill
background or disconnect gaps. CPU history remains Shell-owned; use real
timestamps and gap handling when sharing SVG presentation where appropriate.

Render labelled Auto/interface selection, resolved name, Receive and Transmit
values with `formatRate`, and two compact SVG plots in a two-column network
section. Use a shared finite zero-based maximum from both directions' current
window, with a nonzero fallback for all-zero data. No CPU percentage clamp,
smoothing or fabricated points. Position X by actual server time. Fewer than two
valid values per direction shows `Collecting trend…`.

Keep 320px layout, keyboard labels/focus, a minimum 44px select, unavailable
reasons and sample time. Retain stale curves with the existing last-sample
status; do not fade charts via container opacity.

## Theme

Map `chart-line` to `brand-text`: Dark `#FF8C2F`, Light `#F15A2C`. CPU and both
network curves use the semantic token and immediately follow theme changes.
Titles, arrows and separate plots distinguish directions. No looping graph
animations, status semantics or changes to capacity tokens.

## Validation and delivery

Use TDD for reader, service, API/SSE, trend algorithms, panel and Shell/session
behavior. Run Go race tests and both Go builds, `npm ci`, all frontend tests,
production/PWA build, local image build/smoke checks, compose and XML validation.
Update README, API docs and AGENTS.

For real-host validation, use read-only access to 10.0.0.66. Record native and
app interface selections, B/s × 8 / 1000 conversion to Kbps, continuous
observation in the same window, and route facts explaining Auto. If access to
mounted host files or the updated app is unavailable, mark that part unverified.
Never replace synthetic fixtures with live host files. Do not deploy, publish or
change host settings as part of this task. Separate local, real-host and actual
Android/iOS results.
