# CPU Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Extend trustworthy CPU telemetry and the approved inline CPU disclosure.

**Architecture:** Extend the mounted-host Reader and app Service, preserving REST/SSE
snapshots. Shell owns disclosure/window preferences; useSystem keeps a bounded
null-aware aggregate buffer; SystemPanel presents it with a small CPUDetails component.

**Tech Stack:** Go 1.24, React 19, TypeScript, existing Vitest and SVG.

**Spec:** `docs/superpowers/specs/2026-10-26-cpu-details-design.md`

## Global Constraints

- Read-only mounted host data; no new dependencies, actions, subscriptions or sampling.
- Existing aggregate API and network behavior stay compatible.
- CPU percentage uses adjacent first-eight-field counters with idle+iowait.
- At most 60 samples, 60 seconds, null/gaps >3s break lines; windows 10/30/60s.
- Native disclosure and radios ≥44px; 2 columns; unknown is not zero.
- Shell memory only; logout/reload reset, tabs preserve. No per-value aria-live.
- Existing semantic theme tokens and motion preferences; no expansion animation.
- English code comments/docs, Chinese user explanations. Add function-level comments.

## Review Focus

- Malformed one-CPU counters and CPU disappearance must not contaminate other baselines.
- Non-increasing time and recovery must never produce false idle/busy measurements.
- Old snapshots and absent cpuinfo must retain aggregate telemetry with honest reasons.
- Radio/disclosure identity during refresh and background recovery must preserve focus.
- 100.0% and long model names at 320px with 64 CPUs must remain readable.

### Task 1: Host CPU extension

**Files:** `internal/adapter/system/reader.go`, `reader_test.go`,
`internal/app/system/service.go`, `service_test.go`, `internal/api/system_test.go`;
add focused CPU files if useful; synthetic `testdata/host/proc` fixtures only.

**Interfaces:** Produce cpuInfo `{model, reportedFrequencyHz, logicalCPUCount}` and
cpuLogicalProcessors `{id, usage, reason?}` as specified in the design.

- [x] Write parser/service/API tests for names, averaged Hz, sparse numeric IDs,
  idle+iowait, guest exclusion, first sample, 0/100%, rollback, invalid idle delta,
  unavailable/recovered CPU, new/removed IDs, time reversal, optional failures,
  bounded integer parsing, defensive copying and matching REST/SSE fields.
- [x] Run `go test ./internal/adapter/system ./internal/app/system ./internal/api`;
  confirm failures caused by the absent extension.
- [x] Implement mounted cpuinfo whitelist parsing and independent logical CPU baselines.
- [x] Run gofmt, `go test -race ./...`, `go build ./cmd/server`; review task diff.

### Task 2: CPU presentation and state

**Files:** `web/src/lib/api.ts`, `system.ts`, `system.test.ts`,
`web/src/app/useSystem.ts`, `AppShell.tsx`, `pageData.tsx`, route Home,
`web/src/features/system/SystemPanel.tsx`, `SystemPanel.test.tsx`,
new `CPUDetails.tsx` and focused tests, shell integration tests as needed.

**Interfaces:** Consume Task 1 optional extended fields; export nullable Point,
bounded appendPoint and CPU window filtering; pass Shell preference props via context.

- [x] Write failing tests for null/gap/time-window retention, repeated/changed windows,
  native disclosure/radio focus and identity, numeric IDs/meters/unknown fields,
  refresh/tab/session lifecycle, stale/offline and unavailable state.
- [x] Run targeted Vitest files and confirm absent behavior failures.
- [x] Implement Shell preferences and detail presentation using existing tokens;
  keep SVG/placeholder heights equal and partial history copy visible.
- [x] Run `npm ci`, `npm test`, `npm run build`; review task diff.

### Task 3: Integration and acceptance

**Files:** `AGENTS.md`, `README.md`, new
`docs/validation/2026-10-26-cpu-details.md` and required browser evidence.

- [x] Update CPU contract/behavior documentation; keep optional source semantics explicit.
- [ ] Run full Go/npm checks on integrated code and request independent review.
- [x] Inspect Dark/Light, 320px/landscape, 4/16/64 CPUs, keyboard disclosure/radios,
  refresh identity, offline windows, tab persistence and theme changes.
- [x] Attempt Docker build/smoke/Compose/XML checks; report exact unavailable runtime.
- [x] Read-only continuous native/live API comparison; distinguish deployed extension,
  native observations and untested mobile devices. Do not publish or deploy.
- [ ] Resolve review findings, record actual evidence and remaining validation gaps.
