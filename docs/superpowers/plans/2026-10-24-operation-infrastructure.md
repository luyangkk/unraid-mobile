# Operation Infrastructure Implementation Plan

> **For agentic workers:** Use `executing-plans` to implement each task through RED/GREEN tests, then request an independent review.

**Goal:** Add queryable, subscribable, bounded in-memory operations while keeping all production write capabilities disabled.

**Architecture:** Extend the existing mutex-protected Operation Store. Publish independently cloned snapshots into capacity-one subscriber channels. Multiplex those channels with System snapshots in the existing SSE handler. Expire terminal records on Store access and through a context-owned background timer in the production server.

**Tech Stack:** Go 1.24, `net/http`, standard library concurrency and timers.

**Spec:** The user's Operation infrastructure task dated 2026-10-24; existing architecture in `docs/spec-20260921-mvp.md`, with current behavior governed by `AGENTS.md`.

## Constraints and design decisions

- Keep `pending → running → success/failed/cancelled`; terminal states cannot transition.
- Release the resource immediately on any terminal transition. Eviction touches only operation records.
- `UpdateProgress(id string, progress *float64) (Operation, error)` is valid only while running; nil means unknown, numeric values must be finite and within 0–100.
- Only failed operations retain the supplied structured error. Clone Error, Progress and EndedAt on every input/output/event boundary.
- Serialize Store methods with one mutex, including the injected `now` call.
- Retain at most 100 terminal records. Records expire at 24 hours, ordered by endedAt; equal times retain their order of entering a terminal state.
- Active records are exempt from both limits. The bound is 100 terminal records plus active operations and connected subscribers.
- Prune on reads and writes so expiration is visible immediately with a fake clock. `Run(ctx)` schedules the next terminal expiry and wakes when terminal records change; it performs no lifecycle transitions and stops on context cancellation. Its internal timer factory permits deterministic expiry, rescheduling and cancellation tests.
- `Subscribe() (<-chan Operation, func())` has no initial event or history replay. Cancellation is idempotent, drains pending updates and closes the channel under the Store mutex.
- Slow subscribers retain only the latest event across operations; reconnecting clients query known IDs.
- GET `/api/v1/operations/{operationId}` accepts exactly one nonempty path segment. Extra segments, trailing slash, encoded separators and missing IDs return the shared 404 route error.
- Unknown IDs return 404 `OPERATION_NOT_FOUND`; a valid query without a Store returns 503 `OPERATIONS_UNAVAILABLE`.
- Preserve System snapshots, 15-second comment heartbeat, 5-second write deadlines and SSE headers. Subscribe to both sources before writing the initial System event.
- No executor, client mutation/cancellation endpoint, list, persistence, frontend changes, host writes, or new capabilities.
- Work on `feat/operation-infrastructure`, preserving pre-existing Spike and frontend changes. Do not merge, push or deploy as part of this task.

## Review focus

- NaN and infinities must never enter JSON snapshots.
- Every subscriber needs its own pointer copies; cancellation must be safe while publishing.
- Evicting an old operation must not release a newer operation's lock for the same resource.
- Both SSE subscriptions must be released on cancellation, write failure and flush failure, even during the initial System event.
- Background expiry must stop on server shutdown and must not mark lost operations failed.

## Task 1: Store lifecycle, copies and progress

**Files:** `internal/app/operation/store.go`, `internal/app/operation/store_test.go`, `internal/app/operation/progress_test.go`.

**Interfaces:** Preserve `NewStore`, `Create`, `Get`, `Update`; add `UpdateProgress` and `ErrInvalidProgress`.

- [x] Add table-driven lifecycle, terminal immutability, resource-release, progress-boundary and deep-copy tests. Run `go test ./internal/app/operation`; observe missing progress behavior and copy isolation failures.
- [x] Implement validation and boundary clones with function-level comments.
- [x] Run Store tests, including concurrent creation on distinct and identical resources.

## Task 2: Retention and subscriptions

**Files:** `internal/app/operation/store.go`, `internal/app/operation/retention.go`, `internal/app/operation/retention_test.go`, `internal/app/operation/subscription.go`, `internal/app/operation/subscription_test.go`.

**Interfaces:** Add `Subscribe() (<-chan Operation, func())` and `Run(context.Context)`. No automatic state transitions.

- [x] Add failing count/TTL tests with injected time, active-record preservation and resource-lock reuse tests.
- [x] Add failing no-replay, latest-event, copy isolation, unsubscribe and concurrent publishing/cancellation tests.
- [x] Implement terminal eviction, the expiration timer and nonblocking subscriber delivery.
- [x] Run `go test -race ./internal/app/operation`.

## Task 3: Query and SSE integration

**Files:** `internal/api/server.go`, `internal/api/operation.go`, `internal/api/operation_test.go`, `internal/api/system.go`, `internal/api/events_test.go`, `cmd/server/main.go`, `cmd/server/main_test.go`.

**Interfaces:** GET query returns a full Operation; SSE adds `operation.updated` beside `system.metrics`. The server calls `go operations.Run(ctx)`.

- [x] Add failing 200/404/503 and malformed-route tests, explicit null progress, terminal errors and expiry queries.
- [x] Add failing SSE event/JSON, coexistence and disconnect/write-failure cleanup tests using real Stores and controlled response writers. Check slow clients do not block Store updates, System collection or unrelated requests.
- [x] Implement query routing and multiplexed SSE; retain existing System behavior.
- [x] Verify fake Docker capabilities can create pending operations; default production capabilities reject all start/stop/restart requests.
- [x] Run `go test -race ./internal/api ./cmd/server`.

## Task 4: Documentation, review and final verification

**Files:** `AGENTS.md`, `README.md`, this plan.

- [x] Update current capability descriptions without changing historical host-validation records.
- [x] Request independent review of only this task's changes and resolve material findings with regression tests.
- [x] Run `gofmt -w` on changed Go files, `go test -race ./...`, `go build ./cmd/server`, and `go build ./cmd/host-spike`.
- [x] Since frontend source/types are untouched, frontend checks are outside this change's required scope.
- [x] Report actual checks and deployment status; the user will update the image on 10.0.0.66.

## Verification record

- RED: pointer aliasing, missing progress/subscriptions/cleanup, terminal count/TTL, query contracts and missing Operation SSE were observed before implementation.
- The independent core review returned routing boundary findings and a timer-lifecycle test gap before being stopped by the user's interruption. Both were addressed; the author completed the final read-through.
- Regression RED: encoded namespace separators returned 200 and repeated namespace separators returned redirects. GREEN: canonical and encoded path checks now return the shared route error in both API and production routing tests.
- Timer expiry, terminal-update wake rescheduling, replacement timer shutdown and active-record preservation use fake clocks and timer channels.
- A test-side subscriber-count race in the TCP disconnect test was corrected by checking live delivery, then inspecting subscriber state only after handler exit. Its race test passed ten consecutive runs.
- Final checks: `go test -race ./...`, both requested Go builds and `git diff --check` passed.
- No frontend source/types changed in this task. Frontend checks, image build/publish, host deployment and real-host validation were not run. Existing frontend changes and historical validation records remain outside this task.
- All production write capabilities remain disabled. Fake-capability acceptance creates pending records without execution. No host write requests were added.
