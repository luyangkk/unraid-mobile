# Docker Read-only Display Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans; implement with test-first cycles.

**Goal:** Replace the Docker placeholder with real container state and resource statistics on the existing mobile page.

**Architecture:** A restricted Docker Engine HTTP client reads the fixed Unix socket. An app service samples every two seconds, calculates rates and stores a snapshot. REST serves that cache; React polls it while visible, following the existing Storage implementation.

**Tech Stack:** Go 1.24 standard library, React 19, TypeScript, TanStack Query, existing Tailwind/Lucide components.

**Spec:** ../../spec-20260921-mvp.md (Docker read-only scope), ../../plan-20260921-mvp.md sections 6, 25, 26 and 45; AGENTS.md controls current deployment and scope.

## Global Constraints

- No Docker writes, operation execution, new dependency, routing framework, or general shell/API proxy.
- `app` owns interfaces/models; the adapter alone knows socket paths and Engine JSON.
- Production stays unprivileged. Document the Docker socket mount explicitly; a read-only socket mount does not enforce API permissions.
- Use camelCase, byte units, UTC RFC3339 timestamps and null for unknown statistics.
- API exports only whitelisted fields, never environment variables, full inspect JSON or labels.
- Function-level comments are English. Keep unrelated code unchanged.
- This workspace has no Git metadata; do not initialize a repository, commit or create worktrees.

## Design and Decisions

The user requested completion against the existing MVP documents. This slice implements observation only. Native Engine HTTP over a Unix socket avoids a new SDK dependency and CLI parsing. REST polling matches Storage and avoids adding a second SSE connection or changing System's current protocol. Dedicated Docker routing and action sheets belong to later navigation/operations work.

All running containers appear in an expandable Running group; save its collapsed preference in localStorage. Stopped (including created/exited/dead) starts collapsed. Paused/restarting/unknown states remain visible in a separate Other group. Rows show a generic Lucide container icon, name, actual state, CPU, working-set memory, uptime and network rates. Verified Unraid icon metadata is not currently available, so no guessed logo URL or metadata path is introduced.

## Contract

`GET /api/v1/docker` returns:

```json
{
  "timestamp": "2026-10-24T00:00:00Z",
  "available": true,
  "reason": "",
  "containers": [{
    "id": "full-engine-id",
    "name": "Plex",
    "state": "running",
    "cpuUsage": null,
    "memoryUsedBytes": null,
    "memoryLimitBytes": null,
    "uptimeSeconds": null,
    "networkRXRate": null,
    "networkTXRate": null,
    "diagnostics": []
  }],
  "summary": {"running": 1, "stopped": 0, "other": 0},
  "diagnostics": []
}
```

`capabilities.docker` reports actual read availability. Introduce separate explicit Docker action flags (`dockerActions.start/stop/restart`) defaulting false; `Allows` must check those flags as well as Docker availability. Read success must never cause acceptance of a production POST.

## Review Focus

1. Missing/refused/slow socket: HTTP 200 unavailable snapshot; service and health remain responsive.
2. Per-container stats/inspect failure or removal: retain valid list entries, null affected metrics, diagnostic; do not fail the whole list.
3. First sample, counter regression, restart/identity change, recovery: reset delta baseline, never return fabricated zero.
4. Docker read availability must not enable writes, and API response must omit secret fields.
5. Background and refresh failures: pause polling, retain cached last sample with timestamp and stale indication; distinguish unavailable from empty.

## Verification Record

- Go implementation and frontend/deployment integration completed in the existing workspace.
- Go race suite, server build, frontend 27-test suite/build, XML parsing and shell syntax checks passed.
- Real Chrome checks with synthetic API fixtures passed at 320px and 390px: no horizontal overflow, grouping, persisted Running collapse, Stopped expansion surviving refresh, failed/recovered refresh, hidden polling pause and visible refresh.
- Built Go process smoke passed: health 204, missing-socket snapshot, explicit disabled action flags and rejected action POSTs.
- Independent reviews identified lost request messages/timestamps, startup identity races and unfair telemetry scheduling. Fixes preserve request errors and unavailable sampling timestamps, verify startup identity after stats, and prioritize the first container deferred by the previous sampling budget.
- Added adapter/service regression tests reproduce mixed startup counters and healthy tail starvation before those fixes.
- Scoped independent re-review approved both fixes with zero Critical/Important findings.
- Docker CLI is unavailable: image build, image smoke and compose validation were not run. No target Unraid host was accessed.
- Existing dependency audit reports vulnerabilities; dependencies were not changed in this feature.

### Task 1: Docker adapter, sampler and API

**Files:** Create `internal/adapter/docker/reader.go`, `reader_test.go`, `internal/app/docker/service.go`, `service_test.go`, `internal/api/docker_test.go`; modify `internal/api/server.go`, capability model/tests, server tests, `cmd/server/main.go`.

**Interfaces:** `docker.Reader.Read(context.Context) (docker.Raw, error)`, `docker.NewService(reader Reader, now func() time.Time) *Service`; service methods `Collect(ctx) Snapshot`, `Latest() Snapshot`, `Run(ctx)`; adapter `NewReader(socketPath string) *Reader`. API config adds `Docker *docker.Service`.

- [x] Write failing Unix-socket Engine tests for list(all), inspect uptime, one-shot stats, whitelist and partial failures; run to observe missing functionality.
- [x] Implement fixed GET calls with bounded timeouts/concurrency; honor daemon API version negotiation, no environment-controlled TCP endpoints or CLI.
- [x] Write and observe failing service tests for CPU delta/system delta times online CPUs, memory usage minus inactive_file cache (v1 fallback cache), aggregate network counters, resets/restarts/recovery, empty configuration and defensive cached copies.
- [x] Implement sampler: two-second ticker, skip stats for non-running states; use per-container Engine read timestamp for network elapsed time and stable identity including start time. Do not hold snapshot lock across external I/O.
- [x] Write and observe failing API tests for cached Docker snapshots, missing adapter, dynamic capability, denied writes for read-only adapter, JSON whitelist and nonblocking health.
- [x] Implement API and process lifecycle integration; update existing fake-action tests to opt in explicitly to action flags. Run `gofmt`, `go test -race ./...`, and `go build ./cmd/server` with output outside workspace.

### Task 2: Docker panel and querying

**Files:** Create `web/src/features/docker/DockerPanel.tsx`, `DockerPanel.test.tsx`, `web/src/lib/docker.ts`, `docker.test.ts`; modify `web/src/lib/api.ts`, `api.test.ts`, `web/src/App.tsx`.

**Interfaces:** `getDocker(signal?: AbortSignal, fetcher?: Fetcher): Promise<DockerSnapshot>` with the above contract; `DockerPanel({snapshot, stale?})`.

- [x] Write and observe failing API/panel tests for uncached request and cancellation, all groups, unknown metrics, stopped/other states, empty/unavailable/stale snapshots.
- [x] Implement types, request and formatting using existing byte/rate utilities.
- [x] Implement accessible expandable groups, stable tabular number rows, Running preference saved safely to localStorage, diagnostics and sample timestamp.
- [x] Replace Docker placeholder with Query polling every 2000 ms, no background polling, cancellation and focus refresh; include Docker in manual refresh.
- [x] Run `npm ci`, `npm test`, `npm run build`.

### Task 3: Deployment, documentation and review

**Files:** Modify `deploy/unraid/unraid-mobile.xml`, `README.md`, `AGENTS.md`, `scripts/verify-image.sh`; focused current-slice addendum in `docs/spec-20260921-mvp.md`.

- [x] Add optional fixed Docker socket mount to production XML with Privileged=false, and update install/upgrade instructions. Keep development privileges unchanged.
- [x] Add missing-Docker snapshot smoke assertion; maintain existing checks.
- [x] Explain polling and read/action capability separation; do not claim target-host verification.
- [x] Run XML parsing, Go race tests/builds, frontend tests/build; Docker build/smoke/compose validation if available (Docker CLI unavailable).
- [x] Independent review against this contract; fix material findings and rerun relevant checks.
