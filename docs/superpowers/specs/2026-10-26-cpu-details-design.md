# CPU details and bounded aggregate trends

This records the user's approved shape and implementation request on 2026-10-26.
The existing System panel, website-derived themes and single shared SSE remain
the foundation. All information and interactions are read-only.

## Approved experience

CPU remains beside Memory: aggregate percentage to one decimal, labelled CPU
temperature, fixed-height SVG trend and `Last 10s/30s/60s`. A full-width native
`details/summary` sits below that row and above Network. It defaults closed and
shows the logical CPU count when known. Opening it does not navigate, scroll or
open a Sheet. Summary focus and component identity survive samples.

The expanded content shows Processor, Reported frequency, Logical CPUs, a
labelled native radio group (10s, 30s, 60s), and a two-column wrapping grid of
logical CPU measurements. CPU rows are numbered numerically, keep complete
one-decimal percentages and use 0–100 meter semantics with existing
progress-fill/track tokens. Unknown values show `—` and no invented zero meter.
Model text wraps; units and sampling time use secondary text. Summary and radio
targets are at least 44px. There is no expansion animation, per-CPU trend,
sorting by load, warning threshold, row operation or nested scrolling.

Shell memory owns expanded state and selected window (default 60s); useSystem
owns at most 60 samples within 60 seconds. Tab changes preserve all three;
reload/logout reset them. Radio selection filters the existing buffer, including
offline samples, without requests or sampler changes. Repeated selection leaves
the buffer intact. CPU trends use true timestamps, fixed 0–100 scale, null/gaps
over 3 seconds as breaks, no interpolation and fixed-height placeholders.
Partial history is marked collecting. Theme changes preserve samples.

Existing loading, unavailable, stale, diagnostics and sample time patterns apply.
Optional missing fields get nearby reasons; old responses retain CPU summary and
explain unavailable extended information. System unavailable never reuses old
metrics. Percentages do not use aria-live. Refreshes and details interactions
must not trigger Tab entrance animation.

## Data contract and implementation decisions

Read mounted `proc/stat` once per sample, parsing aggregate and numeric `cpuN`
lines. Sum the first eight counters (guest excluded), with idle plus iowait.
Adjacent valid samples alone produce utilization; first, rollback, invalid
increment, recovery and newly seen IDs return null independently. Current IDs
come from stat, so disappearing CPUs are removed and numbering is preserved.

Keep `cpuUsage` and `cpuTemperature`. Add:

- `cpuInfo`: `{ model: string|null, reportedFrequencyHz: number|null,
  logicalCPUCount: number|null }`, nullable when no extended source is present.
- `cpuLogicalProcessors`: array of `{ id: number, usage: number|null,
  reason?: string }`, always an array in new REST/SSE snapshots.

These field names are implementation choices. Logical count comes from current
stat IDs, not physical topology or cpuinfo. `proc/cpuinfo` only supplies
`model name` and `cpu MHz`; the reported frequency is the arithmetic mean of
finite positive reported MHz values converted to Hz. It describes reported
per-processor samples, not a promised fixed clock or physical core count.
No raw cpuinfo or unrelated fields are exposed. Missing/invalid optional source
information adds `cpuModel`, `cpuFrequency` or `cpuLogicalProcessors` diagnostics
and does not break aggregate CPU, memory, network or temperature.

App snapshots defensively copy the cpuInfo object, optional scalars, logical
processor slice and each usage pointer for cache, REST and SSE consumers.
Existing labelled CPU temperature selection remains unchanged.

## Approaches

The user selected inline native disclosure and compact current per-CPU values,
with selectable aggregate history. Sheet navigation, individual CPU cards and
per-CPU historical charts do not meet the approved shape. Implementation extends
the current Reader/Service and Shell ownership instead of introducing a parallel
transport or state layer.

## Verification

TDD covers parser provenance, numeric IDs, independent baselines, local failures,
recovery, cloning, REST/SSE parity, bounded/null-aware history, selection and focus,
refresh identity, tab persistence/session cleanup and one shared SSE.
Run full Go race/build checks and npm ci/test/build. Build and smoke-check the
image and validate Compose/XML when the local container runtime is available.
Inspect Dark/Light at 320px and landscape with 4/16/64 CPUs. Record synthetic
browser, live host and real mobile device evidence separately. Live comparison
uses 10.0.0.66 read-only; absence of deployed new fields is a validation gap,
not proof of correct new host collection. Do not deploy or publish in this task.
