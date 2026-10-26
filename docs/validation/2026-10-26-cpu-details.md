# CPU details validation — 2026-10-26

This report separates source-level checks, synthetic browser inspection, live
reference observations and real-device acceptance. It is not a release or host
compatibility certification.

## Scope

The approved implementation adds mounted-host model/reported-frequency metadata,
independent current logical-processor usage and an inline native CPU disclosure.
Aggregate CPU history supports 10s/30s/60s windows. All collection and interaction
remain read-only, with one shared System SSE.

Design: [approved specification](../superpowers/specs/2026-10-26-cpu-details-design.md).
Execution: [implementation plan](../superpowers/plans/2026-10-26-cpu-details.md).

## Automated checks

Parser, application, API and frontend behavior were implemented with RED/GREEN
tests. The integrated source passed:

| Check | Result |
| --- | --- |
| `go test -race ./...` | 14 packages passed; final controller run used cached results |
| `go build -o /tmp/unraid-cpu-check/server ./cmd/server` | Passed |
| `npm ci` | Passed; manifest and lockfile unchanged |
| `npm test` | 35 files, 504 tests passed |
| `npm run build` | TypeScript, Vite, injectManifest and PWA checks passed |
| `git diff --check` | Passed |
| Impeccable detector, changed presentation files | No findings (`[]`); run before the final coverage-only predicate fix |

The [final frontend output](2026-10-26-cpu-details/frontend-final.log) records
the controller's post-fix full run. Focused tests also cover model/frequency
parsing, independent counters, copying and REST/SSE parity; null/time bounds,
stable controls, session cleanup, refresh failure/recovery and one stream.
The local toolchain is Go 1.26.2 on darwin/amd64; Go 1.24 is not separately tested.

The frontend baseline passed 459 tests in 33 files. It already emitted React
`act` warnings in `useTabTransition.test.tsx`; dependency installation already
reported deprecations and audit findings. These are baseline observations.
Final tests retain the existing `act` warnings. The final main chunk is 657.58 kB
minified / 209.21 kB gzip, above Vite's 500 kB warning threshold. A fresh read-only
audit reports five findings: `@vitest/mocker` moderate, `source-map-js` and `vite`
high, `tinypool` and `vitest` critical. These locked dependencies were not changed.
Audit severity labels do not establish exposure in the production Go container.

## Synthetic browser inspection

The browser harness serves the actual production assets with synthetic REST/SSE.
It checks Dark/Light, 320px portrait and 844px landscape, with 4/16/64 logical
processors, native keyboard focus, sample refresh, window selection, Tab
persistence, offline selection and one SSE. All twelve layout combinations plus
an old-API response passed. A supplemental 390px check with normal motion enabled
passed: expand/collapse, sample updates and radio changes do not start Tab
animations, and collapse retains the selected window. The complete result is
**15 checks passed, no page errors**, using Chrome 155.0.8059.86:
[browser measurements](2026-10-26-cpu-details/browser-report.json).

Every matrix case verifies Enter disclosure focus, native radio arrow keys,
repeated selection, focus after new samples, no automatic expansion scrolling,
44px targets, meter counts and no viewport overflow. Dark/Light changes, route
return and offline window selection were also exercised. The fixture includes
100.0%, real zero, unknown per-CPU usage and an intentionally long synthetic model.
The screenshots retain actual production assets, including existing PWA UI.
These viewport simulations do not replace Android/iOS acceptance.
The final selective browser check also verifies long missing intervals and null
aggregate samples keep `Collecting history…`, complete retained history removes
it, and recovery keeps the same single stream. The previous fourteen unaffected
cases were retained rather than rerun.

Representative captures:
[Dark, 320px, 4 CPUs](2026-10-26-cpu-details/dark-320-4.png),
[Light, 320px, 64 CPUs](2026-10-26-cpu-details/light-320-64.png),
[landscape, 16 CPUs](2026-10-26-cpu-details/dark-844-16.png).

## Independent review

Backend review approved the mounted source and application/API contract.
Frontend review found one Important omission: sampling time was absent inside
expanded CPU details. Test-first correction added it before the facts/rows;
focused re-review approved the fix. The local time keeps original `dateTime`,
UTC display, stale tokens and DOM identity during refresh/offline/recovery.
The [whole-branch review](2026-10-26-cpu-details/branch-review.md) found no
Critical/Important defects. Its Minor M3 exposed span-only completeness despite
missing interior samples/nulls. A [test-first fix](2026-10-26-cpu-details/coverage-fix.md)
requires usable values and no interval beyond the existing 3000ms gap threshold,
while preserving the one-slot span allowance and full-duration filtering.
[Scoped final re-review](2026-10-26-cpu-details/coverage-review.md) approved that
fix with no new Critical/Important findings. The controller then passed all 504
frontend tests and the fifteenth browser case. M1/M2 remain deferred maintenance.

## Live reference observations

[Recorded read-only observations](2026-10-26-cpu-details/host-reference.json)
cover Unraid WebGUI at `http://10.0.0.66` and the existing application at
`http://10.0.0.66:18080`:

- WebGUI reported `Intel® N100 @ 2871 MHz` and logical IDs 0–3.
- Three native observations and twelve advancing existing-API samples were
  recorded. Both overall utilization and temperature changed during observation.
- The deployed API omits `cpuInfo` and `cpuLogicalProcessors`.
- Native text and animated bars can differ during transitions; different
  sampling windows do not support a precision conclusion.

The displayed MHz value is reference evidence, not an implementation default.
The reported frequency contract averages finite positive mounted cpuinfo MHz
reports and converts to Hz. New-code acceptance must compare that source and
interpretation, the complete logical ID set and continuously observed loads.
Native CPU/motherboard temperature labels alone do not identify the sysfs source.

**Outstanding host acceptance:** no image containing this extension was deployed.
New per-CPU baselines, live frequency interpretation and CPU sensor provenance
remain unverified on the real host. The task does not publish or deploy an image.

## Packaging and real devices

Docker, Podman and Colima are unavailable locally. Requested image build,
`scripts/verify-image.sh` and Compose validation were attempted and could not run
without Docker; XML parsing passed. No runtime or host software was installed.
[Exact packaging command results](2026-10-26-cpu-details/packaging.json) record
exit 127 for each Docker-dependent check and exit 0 for XML parsing. Embedded
production assets inside an actual image remain unverified.

No physical Android or iOS device was used. Touch hardware behavior, orientation
changes and platform rendering remain unverified.

## Decisions made during execution

- Use the existing checkout on `feat/cpu-details`, preserving pre-existing user
  files. A feature branch isolates commits but shares untracked files; an
  incorrect choice would require moving these scoped commits to a worktree.
- Proceed from the already approved shape and explicit implementation request.
  No additional approval gate was needed; a mistaken interpretation would
  require revising the reviewable source.
- Average finite positive per-processor `cpu MHz` reports for the single reported
  frequency. This avoids implying a fixed clock; if source interpretation differs
  on a host, its model/frequency contract must be revised before claiming support.
- Record the unavailable container runtime instead of installing host software.
  Image behavior remains unverified until the packaging checks run elsewhere.
- Consider a trend window collected after `(window - 1)` seconds of retained
  span: 60 samples at 1 Hz span 59 seconds. Actual filtering still uses the full
  selected duration. If this sampling assumption differs, the collecting label
  can become complete up to one second early; it does not change retained data.
- Keep M1 test synchronization and M2 bundle profiling outside this feature.
  Their inherited warning/performance uncertainty remains until separate work
  addresses them. The same applies to unchanged dependency-advisory maintenance.

The final review's excluded judgments are explicit in its report: real-host
compatibility/sensors, image/mount/runtime acceptance, physical devices, separate
Go 1.24/Linux execution, complete advisory exploitability and measured startup
performance were not established. Numerical contrast thresholds remain waived
by the current project rules. Physical-core topology, per-CPU history, durable
telemetry, multi-host support and write controls remain outside this scope.
