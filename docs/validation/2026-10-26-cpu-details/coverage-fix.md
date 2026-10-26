# Final Fix Report: M3 CPU History Coverage

## Scope And Result

- Repository: `/Users/bytedance/Work/feWorkspace/unraid-mobile`.
- Branch: `feat/cpu-details`, retained without branch/worktree changes.
- Base: `d1672476e6c18f5e77da0c264d647abcb1740af4`.
- Scoped commit: `6ac5e6cd0f287fa80686192d626ad43ec85d8764`.
- Commit subject: `fix(web): keep incomplete CPU history collecting`.
- M3 fixed: incomplete selected CPU history retains the collecting indication.
- M1 deferred: inherited pending-route act warning; no synchronization changes.
- M2 deferred: main-bundle warning; no dependencies, splitting or threshold changes.
- Read the final-fix brief first, then the complete final review (M3, M1, M2)
  and the approved CPU-details design. No new design gate.
- Applied systematic-debugging, receiving-code-review, TDD, React guidance
  and verification-before-completion. No subagents or reviewer.

## Root Cause And Minimal Fix

The previous predicate checked only sample count and first-to-last span.
Samples at seconds 0, 1, 59, 60 pass that check despite a 58-second hole.
Sixty timestamped samples with only the first two and last two values valid
also pass despite missing interior coverage. The SVG already preserves these
breaks; only the explanatory collecting copy was wrong.

`SystemPanel.tsx` now derives `cpuHistoryComplete` from the already-filtered
CPU points. It requires:

- At least two retained points.
- The unchanged `(cpuWindow - 1) * 1000` minimum span.
- Every retained value non-null, finite and nonnegative, matching the existing
  Sparkline/shared renderer definition of a usable value. Measured zero is valid.
- No adjacent interval exceeding the existing `trendLimits.gapMs` (3000ms).

The predicate controls only the existing collecting paragraph. No new helper,
state, effect, request, stream, animation, key, meter or sampling behavior.
`appendPoint`, `filterCPUWindow`, shared geometry and network runtime code
are unchanged. In particular, filtering still uses the full selected duration,
not the one-slot completeness allowance.

## TDD RED

All new test cases were written before implementation. Existing production
code was unchanged during this run.

Working directory: `/Users/bytedance/Work/feWorkspace/unraid-mobile/web`.

```sh
npm test -- src/lib/system.test.ts src/features/system/SystemPanel.test.tsx --reporter=verbose
```

Observed output, ANSI removed:

```text
> unraid-mobile-web@0.1.0 test
> vitest run src/lib/system.test.ts src/features/system/SystemPanel.test.tsx --reporter=verbose
RUN v3.2.7 /Users/bytedance/Work/feWorkspace/unraid-mobile/web
Test Files  1 failed | 1 passed (2)
Tests       15 failed | 26 passed (41)
Start at    23:32:35
Duration    2.01s
Exit        1
```

Exact failing test names in `src/features/system/SystemPanel.test.tsx`:

1. `keeps collecting history for a 10s window with a long interior gap`
2. `keeps collecting history for a 30s window with a long interior gap`
3. `keeps collecting history for a 60s window with a long interior gap`
4. `keeps collecting history for a 10s window with interior null samples`
5. `keeps collecting history for a 30s window with interior null samples`
6. `keeps collecting history for a 60s window with interior null samples`
7. `keeps collecting history when endpoint 0 is null despite a complete span`
8. `keeps collecting history when endpoint 59 is null despite a complete span`
9. `keeps collecting history when an interior value is unusable (NaN)`
10. `keeps collecting history when an interior value is unusable (Infinity)`
11. `keeps collecting history when an interior value is unusable (-1)`
12. `uses the exact 3001 ms gap boundary for collecting history and CPU segments`
13. `checks collecting history over the full selected 10s duration, not the one-slot allowance`
14. `checks collecting history over the full selected 30s duration, not the one-slot allowance`
15. `checks collecting history over the full selected 60s duration, not the one-slot allowance`

Fourteen failures expected the missing `Collecting history\u2026` copy.
Representative actual assertion:

```text
AssertionError: expected 'SystemCPU25.0%CPU temperature 42.0 ...' to contain 'Collecting history\u2026'
```

The 3001ms test instead asserted the presence boolean:

```text
AssertionError: expected false to be true // Object.is equality
- Expected: true
+ Received: false
```

These were behavioral assertion failures, not setup/import/compiler errors.
The accepted 3000ms case, continuous history and insufficient-span controls
already passed on the original implementation.

Additional exact new passing test names:

- `uses the exact 3000 ms gap boundary for collecting history and CPU segments`
- `completes continuous 10s history with the one-slot span allowance and measured zeros`
- `completes continuous 30s history with the one-slot span allowance and measured zeros`
- `completes continuous 60s history with the one-slot span allowance and measured zeros`
- `keeps collecting history just below the 10s one-slot span allowance`
- `keeps collecting history just below the 30s one-slot span allowance`
- `keeps collecting history just below the 60s one-slot span allowance`
- `retains nulls at the full 10s cutoff without applying the one-slot completeness allowance`
- `retains nulls at the full 30s cutoff without applying the one-slot completeness allowance`
- `retains nulls at the full 60s cutoff without applying the one-slot completeness allowance`

The three cutoff tests are in `src/lib/system.test.ts`. They assert inclusive
full-duration cutoffs, exclusion at cutoff minus 1ms, retention of nulls in the
first allowance slot, original point identity and no buffer mutation.
The test timestamp helper now preserves fractional-second precision.

After RED, the continuous-history tests were strengthened before GREEN:
they first produce the real capped 60-point/59-second buffer with `appendPoint`,
then retain the last 10/30/60 points to exercise the exact 9/29/59-second span
boundaries. No behavioral expectation was relaxed.

## Focused GREEN

Same working directory and command as RED, after the minimal panel fix:

```sh
npm test -- src/lib/system.test.ts src/features/system/SystemPanel.test.tsx --reporter=verbose
```

Observed output, ANSI removed:

```text
> unraid-mobile-web@0.1.0 test
> vitest run src/lib/system.test.ts src/features/system/SystemPanel.test.tsx --reporter=verbose
RUN v3.2.7 /Users/bytedance/Work/feWorkspace/unraid-mobile/web
Test Files  2 passed (2)
Tests       41 passed (41)
Start at    23:33:06
Duration    2.06s
Exit        0
```

All 15 RED cases and all 10 additional new control cases passed.
There are 9 library tests and 32 panel tests, including the existing metric,
unavailable-host, network, geometry, placeholder and stale-text assertions.
No act warnings or other warnings appeared in this focused run; this does not
claim resolution of M1 in the separate inherited route test.

Boundary evidence:

- 3000ms: no collecting-history copy, one CPU polyline.
- 3001ms: collecting-history copy present, two CPU polylines.
- Long holes and interior nulls: copy present, two CPU polylines.
- Continuous 10/30/60 samples spanning 9/29/59 seconds: copy absent, one polyline.
- Span 1ms below each allowance: copy present.
- Null at the full selected-duration cutoff: copy present even with a complete
  valid suffix spanning the one-slot minimum; a valid suffix alone completes.
- Zero-valued samples remain valid; no invented zero values or connected holes.

## Production Build

Working directory: `/Users/bytedance/Work/feWorkspace/unraid-mobile/web`.

```sh
npm run build
```

Observed output, ANSI removed:

```text
> unraid-mobile-web@0.1.0 build
> tsc -b && vite build && node scripts/verify-pwa.mjs
vite v6.4.3 building for production...
2238 modules transformed.
dist/index.html                     1.69 kB | gzip:   0.76 kB
dist/assets/index-DlFmTS-w.css      27.86 kB | gzip:   6.31 kB
dist/assets/VMPage-Bfi1Q21R.js       0.33 kB | gzip:   0.25 kB
dist/assets/StoragePage-wfJZpONP.js  0.34 kB | gzip:   0.25 kB
dist/assets/DockerPage-BDKjTbqR.js   0.39 kB | gzip:   0.28 kB
dist/assets/index-CSbKtUvU.js      657.58 kB | gzip: 209.21 kB
(!) Some chunks are larger than 500 kB after minification.
built in 2.61s
PWA v2.0.0
Building src/sw.ts service worker ("iife" format)...
2 modules transformed.
dist/sw.js 2.85 kB | gzip: 1.26 kB
built in 1.19s
mode      injectManifest
format:   iife
precache  12 entries (716.99 KiB)
files generated
  dist/sw.js
PWA build checks passed: manifest, 5 opaque icons, 12 static precache entries, offline routes, network-only boundaries, old chunk migration, failed-install isolation, consent activation
Exit 0
```

TypeScript, production Vite build, worker generation and the normal PWA checker
passed. The existing M2 warning remains; no warning suppression or threshold
change. Generated build output was not manually edited or staged.
The controller was notified that the production build is ready for its
supplemental `--coverage` browser check.

## Self-Review And Commit Verification

- Reviewed the complete three-file diff before staging.
- Runtime change is only the coverage predicate and the existing copy guard
  in `SystemPanel.tsx`, reusing `trendLimits` from its existing network import.
- No runtime library changes; full-duration filtering and bounded retention
  remain byte-for-byte unchanged.
- The renderer's existing value validity and gap semantics match the predicate.
- No stricter 1Hz point-count rule; exact 3000ms continuity is accepted.
- Existing valid 60-sample/59-second history still completes.
- No buffer resets, history mutation, clock-based filtering, new transports,
  per-value animations, meter changes, keys or network behavior changes.
- Existing English function-level comments retained; new/changed test helpers
  have English function-level comments.
- Parent docs, harness, branch, dependencies and pre-existing user files untouched.
- No additional defect found in this scoped self-review. This is not an
  independent reviewer sign-off or whole-branch/host/device readiness claim.

Commands from the repository root:

```sh
git diff --check
git add -- web/src/features/system/SystemPanel.tsx web/src/features/system/SystemPanel.test.tsx web/src/lib/system.test.ts
git diff --cached --check
git diff --cached --stat
git commit -m "fix(web): keep incomplete CPU history collecting"
git log -2 --format=fuller --stat
git rev-parse HEAD
git reflog -4 --format='%h %gs'
git status --short --branch
```

Both whitespace checks exited 0 with no output. Staged diff:

```text
web/src/features/system/SystemPanel.test.tsx | 80 ++++++++++++++++++++++++++++
web/src/features/system/SystemPanel.tsx      |  8 ++-
web/src/lib/system.test.ts                   | 20 +++++--
3 files changed, 103 insertions(+), 5 deletions(-)
```

The commit execution tool's final response unexpectedly surfaced exit 1 and
`nothing added to commit but untracked files present`. No retry or empty
commit was made. Subsequent independent log, HEAD and reflog inspection
confirmed that the exact requested commit already exists:

```text
commit 6ac5e6cd0f287fa80686192d626ad43ec85d8764
    fix(web): keep incomplete CPU history collecting
    3 files changed, 103 insertions(+), 5 deletions(-)
parent d1672476e6c18f5e77da0c264d647abcb1740af4
reflog: 6ac5e6c commit: fix(web): keep incomplete CPU history collecting
```

Tracked worktree/index were clean after the commit; original unrelated
untracked user files remain untouched. This report is deliberately left as the
requested local artifact under the existing ignored `.superpowers/sdd` tree,
not force-added to the frontend-only commit.

## Deferred Verification And Concerns

Exactly one focused RED, one focused GREEN and one normal production build
were run. No installs, broad/full frontend suite, Go checks, image/Compose
checks, browser execution, launcher/detector reruns, deployment or push.

The controller owns the scoped re-review, final full-test bookkeeping and
supplemental browser `--coverage` checks for gap/null/complete recovery. Its
earlier 14 checks remain separate evidence; no unaffected matrix was rerun
by this implementer, and no browser pass is claimed here.

M1 and M2 remain deferred maintenance as ruled. Live-host extension behavior,
image contents and physical mobile-device acceptance were not verified in
this frontend-only wave.
