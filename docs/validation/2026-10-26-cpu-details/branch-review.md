# Final Whole-Branch Review: CPU Details

## Scope And Method

- Repository: `/Users/bytedance/Work/feWorkspace/unraid-mobile`.
- Base: `7b0bad2182c7a3f772c695f46c9e57f8e96012f1`.
- Head: `d1672476e6c18f5e77da0c264d647abcb1740af4`, independently confirmed.
- Reviewed all 3,995 lines of `.superpowers/sdd/2026-10-26-cpu-details/review-7b0bad2..d167247.diff` in contiguous, nonoverlapping chunks. The package covers four commits and 50 files. No branch diff was regenerated.
- Applied the `requesting-code-review/code-reviewer.md` whole-branch contract and SDD final-review method. Read the approved design, implementation plan, this plan's ledger, validation artifacts and earlier review reports. Earlier task approvals did not substitute for this pass.
- Inspected surrounding code only for identified integration risks: shared SVG rendering, sampler/cache/SSE ownership, session teardown, transport recovery, dependency/runtime boundaries and the deferred warning's baseline.
- No subagents, model selection, installs, suite reruns, browser runs, publication, deployment, or repository/index/branch mutations. The sole deliberate file write is this report.

## Strengths

- Mounted `proc/stat` is read once per sample for aggregate and logical counters. Checked uint64 addition, first-eight-counter summation, idle+iowait, numeric ID ordering and local malformed-row handling are implemented together (`internal/adapter/system/cpu.go:14-83`). Optional cpuinfo reads whitelist model/frequency fields and cannot invalidate otherwise readable System telemetry (`:87-133`; `reader.go:37-47`).
- Aggregate and logical baselines are independent. First/recovered/new CPUs, rollback, invalid increments and non-increasing time produce null; disappearance drops only the corresponding logical baseline (`internal/app/system/cpu.go:33-95`). Cache, returned snapshots and separate subscribers own independent metadata, optional scalars, slices and usage pointers (`service.go:105-159,211-243`).
- Frontend ownership matches the existing architecture: Shell preferences, one useSystem buffer, one shared stream, unchanged route-scoped resource polling. Native disclosure/radio identity, session cleanup, stale timestamps and unavailable-state removal have focused integration coverage (`web/src/app/cpu.test.tsx`; `CPUDetails.test.tsx`).
- The UI uses labelled 0-100 meters, real zero versus unknown, stable numeric IDs, complete one-decimal values, existing theme tokens and no per-value live region. The I1 CPU-local timestamp fix is present before the facts/rows and preserves the original timestamp (`CPUDetails.tsx:27-29`). Documentation explicitly separates synthetic checks from undeployed host fields and untested devices.

## Issues

### Critical (Must Fix)

None found in the reviewed branch.

### Important (Should Fix)

None found in the reviewed branch.

### Minor (Nice To Have)

1. **M3: Incomplete CPU history can lose its collecting indication.**
   - Location: `web/src/features/system/SystemPanel.tsx:75-76`.
   - The predicate checks only retained first-to-last span. Four samples at seconds 0, 1, 59 and 60 satisfy a 60s window despite a 58s missing interval. Likewise, 60 samples with only the first two and last two non-null suppress `Collecting history...`.
   - A focused, write-free in-memory esbuild/React static-render check exercised the actual SystemPanel and appendPoint. Continuous history retained 60 valid points and one polyline; the gap case retained four valid points and two polylines; the null case retained 60 points, four valid, and two polylines. All three omitted the history-collecting indication.
   - The design requires partial history to be marked collecting (`docs/superpowers/specs/2026-10-26-cpu-details-design.md:27-30`). The ledger's one-sampling-slot tolerance explains a 59s span for 60 samples, but not missing interior coverage.
   - Impact is limited to explanatory copy: gaps remain visible and neither measurements nor missing values are fabricated. This is a nonblocking Minor, not a telemetry-integrity failure.
   - Suggested follow-up: require valid, sufficiently continuous coverage before removing the indication, retaining the approved cadence tolerance. Add focused gap/null completeness assertions; do not clear the buffer or change sampling.

2. **M1: Existing pending-route visibility test emits act warnings.**
   - Location: `web/src/app/useTabTransition.test.tsx:436-437`; evidence: `docs/validation/2026-10-26-cpu-details/frontend-final.log:73-95`.
   - Foreground restoration dispatches `visibilitychange` outside `act`. The same statements exist at the supplied base, independently inspected with `git show`; this file is not changed by the branch.
   - The integrated suite reports success, but these warnings weaken synchronization confidence in that test. No CPU regression is demonstrated.
   - Triage: nonblocking inherited Minor. Wrap restoration/dispatch and resulting updates in the owning test's `act` boundary in separate maintenance; do not suppress warnings.

3. **M2: The production main chunk remains above the Vite warning threshold.**
   - Location: `docs/validation/2026-10-26-cpu-details/frontend-build.log:15-20`; relevant configuration: `web/vite.config.ts:6-22`.
   - Recorded size is 657.43 kB minified / 209.15 kB gzip against the 500 kB warning threshold. Build and static PWA verification completed.
   - This raises cold-load/parse cost on phones, but no measured device slowdown or CPU-specific size regression is established. No new dependency or artificial warning-limit override was introduced.
   - Triage: nonblocking performance Minor. Profile existing bundle composition and actual device startup before choosing separate, scoped splitting work. Do not restructure this feature or merely increase the warning threshold.

## Cross-Layer Assessment

| Area | Result |
| --- | --- |
| Read-only safety | Fixed mounted paths; no commands, host writes, action enabling, URL proxy or new collection schedule. Existing labelled temperature selection is unchanged. |
| Partial failures | Invalid logical rows remain local; absent optional metadata retains aggregate/memory/network/temperature. Whole-reader failure emits an unavailable snapshot without old CPU fields and resets CPU baselines. |
| REST/SSE and copying | Both serialize the same Snapshot contract. Always-array logical rows also hold for zero/unavailable snapshots. Real Reader/Service API tests exercise initial/live parity and prove requests do not sample (`internal/api/cpu_test.go:31-141`). |
| Bounds and nulls | At most 60 points within 60s; duplicate/equivalent/older instants rejected. Selection filters retained history against its last timestamp. Shared renderer breaks nulls and gaps over 3s and receives a fixed CPU maximum of 100 (`web/src/lib/network.ts:30-53`). M3 affects the collecting copy only. |
| Legacy shape | Optional TypeScript extension fields and empty-row fallbacks preserve old aggregate UI and provide nearby explanations. No replacement transport or mandatory new field is imposed on old servers. |
| Lifecycle | Tab/theme/window changes preserve buffers/preferences without another SSE; unavailable collection hides metrics and resets CPU history. Logout/401 unmount protected consumers and clear Query cache; new sessions reset closed/60s (`SessionGate.tsx:25-35,86-88`; `useSystem.ts:38-63`). |
| Focus/status/layout | Native summary/radios, stable keys and no expansion effects preserve focus. Stale text does not fade meters/SVG/status colors. Recorded layout targets are 44px; representative Dark collapsed 320px, Light expanded 320px/64 CPUs and Dark landscape/16 CPUs captures were inspected. |
| Documentation | Contract, logical-versus-physical count, averaged reported Hz, read-only status and acceptance limits agree with source. Task 3's pending final-review bookkeeping is expected at this review boundary, not missing runtime functionality. |

## Dependency Audit Impact

The five package findings were assessed from the committed audit JSON and actual lockfile, not accepted solely from the validation narrative. Base/head git blob identities match for both `web/package.json` and `web/package-lock.json`: these dependency versions did not change.

| Locked Package | Audit Label | Source-Level Exposure Assessment |
| --- | --- | --- |
| `@vitest/mocker` 3.2.7 | Moderate | Mock-server file-read/code-injection advisories concern test tooling. No mock server or new mock registration endpoint is introduced into the production application. |
| `source-map-js` 1.2.1 | High | Indexed-source-map denial-of-service affects consumers processing crafted maps. The application adds no source-map input endpoint; build-tool exposure is not eliminated by unchanged versions. |
| `tinypool` 1.1.1 | Critical | Worker-option/prototype-pollution gadget advisories concern Node workers. A label does not prove a reachable remote input chain through this Go application. |
| `vite` 6.4.3 | High | Editor-launch, middleware and dev-server file-serving advisories concern development tooling; some are Windows-specific, but the report also lists non-Windows behavior. Controlled development is not immunity. |
| `vitest` 3.2.7 | Critical | The aggregate label includes mocker/tinypool findings. It does not establish a production test-server or worker endpoint. |

In particular, lock metadata marks `vite` and `source-map-js` as non-dev, so `--omit=dev` would not by itself establish production safety. The stronger runtime boundary is `Dockerfile:1-19`: Node tools run in the build stage; the final stage copies only the Go binary, which embeds static assets, not node_modules or a Vite/Vitest server. This branch adds no path exposing the audited Node services. No branch-introduced Critical/Important security issue is established from these findings.

They remain actionable inherited tooling debt, not security clearance. Keep development/test services private, avoid untrusted worker options/mock registrations/source maps, and assess supported updates separately without an unreviewed `npm audit fix --force`. Actual image contents were not verified locally.

## Verification Evidence And Limits

- Read the recorded integrated frontend output: 35 files / 479 tests passed, with the M1 warnings. Read build/install output: npm ci, TypeScript, Vite, injectManifest and PWA checks completed; installation records deprecations and the five audit findings.
- The ledger and Task 1 report record Go race checks across 14 packages and a successful build; the controller's final race run used cached results. Raw controller Go output is not present among the supplied committed logs, so this is attributed controller/report evidence, not a fresh independent Go execution.
- Parsed browser-report.json: 14 checks marked passed, errors array empty, synthetic=true. Inspected the existing external harness: it serves built assets with synthetic REST/SSE, asserts keyboard operation/focus/targets/overflow and one stream, and includes a normal-motion case. It is not host telemetry or physical-touch validation. The old-response case is a narrower smoke check; richer legacy behavior is covered in source tests.
- Packaging records three Docker-dependent commands exiting 127 and XML parsing exiting 0. XML success does not validate Compose, the image, mounts or embedded assets in a real container.
- Existing host-reference.json explicitly records no deployed new fields. Its advancing older API samples/native observations cannot establish correctness of new logical baselines or averaged frequency.
- Only one focused diagnostic execution was performed: the write-free static-render reproduction for M3 above. No previously evidenced suite was repeated.

## Recommendations

- Carry M1 and M2 forward as nonblocking deferred maintenance; record M3 for a focused collecting-indication follow-up. The existing window-minus-one ruling need not be reversed, but does not resolve M3.
- The other ledger rulings are consistent with the reviewed scope: existing-checkout preservation, prior design approval, explicitly averaged reported frequency and recording absent Docker instead of installing software. No new execution ruling, source fix or cleanup was made by this reviewer.
- Close final-review bookkeeping through the controller. Preserve separate image, live-host and real-device acceptance gates before claiming deployment readiness; this review authorizes none of those actions.

## Declined To Judge

Declined to judge: correctness of new telemetry on Unraid 7.1.0 hardware, live frequency interpretation and actual CPU sensor provenance; no image containing the extension was deployed.

Declined to judge: successful image build/smoke test, Compose validity, actual production mounts/permissions and embedded assets inside a built image; Docker-dependent checks exited 127.

Declined to judge: physical Android/iOS touch behavior, Safari rendering, orientation transitions and hardware safe-area behavior; Chrome viewport/keyboard simulations are not physical-device evidence.

Declined to judge: separately verified Go 1.24/Linux compilation and execution; the recorded local toolchain was Go 1.26.2 on macOS and container verification was unavailable.

Declined to judge: complete exploitability or remediation certification for the inherited tooling advisories; assessed changed exposure and build/runtime boundaries, without an advisory exploit audit or dependency changes.

Declined to judge: measured phone cold-start/parse performance and CPU-specific bundle growth; the supplied artifacts establish size, not a device benchmark or a comparable base build.

Declined to judge: enforcing previously waived numerical contrast thresholds; current user-authored website-derived theme requirements govern this review, while labels/focus/semantics remain assessed.

Declined to judge: physical-core topology, per-CPU historical charts, durable/offline telemetry, multi-host support and write controls; these are explicitly outside the approved read-only logical-CPU feature.

## Assessment

**Ready to merge? Yes, at source level, with three nonblocking Minor follow-ups.**

No Critical or Important defect was found across the full branch. Backend/frontend contracts, independent baselines, snapshot ownership, session/transport lifecycle and read-only boundaries are coherent; M3 is a limited presentation discrepancy rather than fabricated telemetry.

**Release/host/device readiness: not established.** Image/Compose, deployed new-field host acceptance, the minimum production toolchain and physical mobile acceptance retain the stated validation gaps. Merge readiness is not permission to push, publish or deploy.
