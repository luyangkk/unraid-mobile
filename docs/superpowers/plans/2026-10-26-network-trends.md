# Network Trends Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Display selectable host RX/TX and live network trends alongside brand-colored CPU trends.

**Architecture:** Extend the existing System reader/service complete snapshot. Keep selection and trends in persistent `useSystem`; render SVG without adding subscriptions or libraries.

**Tech Stack:** Go 1.24, React 19, TypeScript, TanStack Query/Router, SVG, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-network-trends-design.md`

## Global Constraints

- Use only existing read-only mounts; counters `proc/1/net/dev`, routes `proc/1/net/route`.
- System samples every second; REST and SSE read cached complete snapshots.
- API rates are B/s; UI uses `formatRate`, 1024 units.
- New `networkInterfaces` array; retain Auto legacy fields from the same calculation.
- Selection is browser/Shell memory only, defaults to Auto, persists across tabs.
- 60 points, latest 60 seconds, duplicate/older timestamps rejected; gaps >3s and null split paths.
- Dark chart `#FF8C2F`, Light `#F15A2C`; capacity colors unchanged.
- TDD; function-level English comments; preserve unrelated files; no host writes or publishing.

## Review Focus

- Route failure with readable counters must leave manual choices available (Task 1).
- Cache consumers must not mutate arrays or pointed-to rates (Task 1).
- Missing manual interface stays selected, with no fallback (Task 2).
- Same timestamp or stale reconnect event must not append or roll back curves (Task 2).
- Long names, zero values and very large rates must fit and produce finite SVG (Task 2).

### Task 1: Backend interfaces, independent rates and complete snapshots

**Files:** `internal/adapter/system/reader.go`, `reader_test.go`,
`internal/app/system/service.go`, `service_test.go`, `internal/api/system_test.go`,
`testdata/host/proc/1/net/dev`, optional synthetic `sys/class/net/*/ifindex`,
`scripts/verify-image.sh`.

**Interfaces:** Add app `NetworkInterfaceRaw` (name, availability, reason, RX/TX counters, optional identity) and `NetworkInterfaceSnapshot`; `Raw.NetworkInterfaces` and `Snapshot.NetworkInterfaces`. Legacy Raw fields can remain for existing readers/tests but production derives them from the new array.

- [x] Add reader failing tests: all sorted interfaces, lowest valid metric Auto, no/malformed route with manual counters, missing mounted dev without container fallback, malformed row isolated, identity observed through mounted sysfs.
- [x] Add service failing tests: independent rates over 2s, first/new samples null, unchanged zero, rollback/local failure/removal/recovery isolated, Auto changing to an already tracked interface uses its own baseline, identity changes reset, whole read failure resets, array/rate/optional-pointer defensive cloning for Collect/Latest/subscribers.
- [x] Add REST/SSE failing tests: equal complete JSON fields and requests/subscriptions do not increment reader call count.
- [x] Run focused tests and record intended failures.
- [x] Implement reader and service with stable name ordering and per-interface timestamped baselines. Empty arrays serialize as `[]`.
- [x] Extend synthetic fixtures and image smoke assertions to check new array and Auto projection.
- [x] Run `go test ./internal/adapter/system ./internal/app/system ./internal/api`; self-review and report evidence.

### Task 2: Shell selection, trends, panel and theme

**Files:** `web/src/lib/api.ts`, `web/src/lib/system.ts`, new `network.ts`/`network.test.ts` if warranted, `web/src/app/useSystem.ts`, `web/src/routes/HomePage.tsx`, `web/src/features/system/SystemPanel.tsx`, `SystemPanel.test.tsx`, `web/src/App.test.tsx`, `web/src/lib/api.test.ts`, `web/src/lib/stream.test.ts`, `web/src/styles.css`, `web/src/lib/palette.test.ts`.

**Interfaces:** TS optional `SystemSnapshot.networkInterfaces?: NetworkInterfaceSnapshot[]` for old-response compatibility. Hook exports `networkSelection`, selection callback, selected interface and network points; selection `string | null`. Network points hold timestamp plus nullable RX/TX. Panel receives hook state without creating a subscription.

- [x] Add failing algorithm tests for 60-point/window bounds, duplicate/out-of-order rejection, null and >3s gaps, real-time X, common maximum, zero and finite extreme rates.
- [x] Add failing panel tests for labelled selection/Auto resolved name, disappeared selected option/reason, old Auto fallback, independent Receive/Transmit collecting states, theme token SVG and finite paths.
- [x] Add failing Shell integration tests for selection/reset/Auto switch, tab persistence, background/reconnect gaps, logout/401 cleanup, theme updates without new SSE.
- [x] Verify failures, then implement minimal state/selector/renderer with existing stream input.
- [x] Change `chart-line` to brand-text and replace old palette exclusion assertion; keep capacity assertions.
- [x] Extend API/SSE fixtures with array and legacy compatibility tests.
- [x] Run complete `npm test` and production build; self-review and report evidence.

### Task 3: Documentation, host evidence and final checks

**Files:** `README.md`, `docs/http-api.md` (use existing API documentation path if different), `AGENTS.md`, `docs/validation/2026-10-26-network-trends.md`.

- [x] Document API contract, Auto/manual behavior, identity limitations, unit conversion, window/gap handling and new chart colors; record Docker write actions deferred.
- [x] Inspect native Dashboard and route evidence using only authorized read-only access; compare same-interface continuous observations when updated runtime can be used without host changes. Attempted: native login and refused SSH prevent new-version/route comparison; old deployed SSE observed for 32 seconds, limitations recorded.
- [x] Run `npm ci`, `npm test`, `npm run build`, `gofmt`, `go test -race ./...`, `go build ./cmd/server`.
- [x] Run local `docker build -t unraid-mobile:local .`, image smoke, `docker compose config`, XML parse. Record failures/blocked checks accurately. Attempted: Docker CLI absent; XML passes.
- [x] Perform browser UI verification for selector, plots, tab persistence, themes and 320px layout with a local synthetic runtime.
- [x] Obtain independent review, resolve material findings, and report local/host/mobile verification separately. Task reviews and final overall review: Spec PASS, Quality PASS.
