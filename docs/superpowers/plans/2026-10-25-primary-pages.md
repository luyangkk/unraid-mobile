# Primary Pages Implementation Plan

> **For agentic workers:** Use executing-plans for integration and dispatching-parallel-agents for independent backend and panel tasks. Steps use checkbox syntax.

**Goal:** Implement Home, Docker, VM and Storage URLs with an accessible mobile shell and controlled production SPA fallback.

**Architecture:** Keep QueryClientProvider and SessionGate outside RouterProvider. A persistent root AppShell owns the System subscription, trend and connectivity state; exclusive route components own polling observers. Existing feature panels accept an overview mode, keeping full rendering as the default.

**Tech Stack:** Existing Go, React 19, Vite, TanStack Query and Lucide; add only TanStack Router.

**Spec:** The user's four-primary-pages task, with current contracts in `AGENTS.md`, `docs/spec-20260921-mvp.md` and `docs/plan-20260921-mvp.md`.

## Global Constraints

- Browser History routes: `/`, `/docker`, `/vm`, `/storage`; lazy load the three detail route components.
- QueryClient remains shared; authentication gates the entire router; no business snapshots in storage or route state.
- System has one persistent SSE subscription and at most 60 in-memory CPU points.
- Docker and Storage poll every 2000ms; VM every 3000ms; only mounted page observers poll, and background pages pause.
- Home shows running containers and VMs, Array/Parity and pool capacity summaries; full stopped/other/disk lists belong to detail pages.
- Preserve read-only capabilities, Operation and auth API behavior. No actions, sheets, animations, themes or PWA changes.
- Static GET/HEAD fallback only for valid extensionless client paths; missing assets are 404; API dispatch precedes path normalization.
- English code comments at function level. Preserve existing dependency versions and untracked host validation records.

## Review Focus

- Route changes during a pending request must not introduce concurrent polling or clear cache/trend.
- Offline, hidden and Query-paused states must retain snapshots, show consistent stale treatment and include sample time.
- Late unauthorized responses must unmount the entire router and stop all transports.
- Encoded separators, dot segments, directory paths and repeated slashes must not expose assets or bypass API auth.
- Long resource names at 320px and navigation in landscape must remain usable.

### Task 1: Controlled Go fallback

**Files:** `cmd/server/main.go`, new static handler and tests in `cmd/server`.

**Interface:** `newFrontendHandler(apiHandler http.Handler, staticFiles fs.FS) http.Handler`, used by production server and integration tests.

- [x] Add failing table tests for valid deep links, HEAD, extensionless Not Found paths, existing assets, missing assets, methods, health, API errors and malformed paths with/without APP_TOKEN.
- [x] Run `go test ./cmd/server`; confirm missing deep-link behavior fails.
- [x] Implement validation before static serving and extensionless fallback, preserving `routeAPIRequests`.
- [x] Run backend tests, race checks and `go build ./cmd/server`.

### Task 2: Feature overview and stale presentation

**Files:** DockerPanel, VMPanel, StoragePanel and their existing tests.

**Interface:** Add `overview?: boolean`, `stale?: boolean`, `errorMessage?: string` to panels; full mode remains default.

- [x] Add failing tests proving overview omits stopped/other and disks/diagnostics, while retaining running resources and capacity summaries.
- [x] Verify stale samples retain data, have faded styling, include sampling time and distinguish refresh errors from offline/paused.
- [x] Implement conditional overview content; place typed router entry links in HomePage to keep panels independent of routing.
- [x] Run focused panel tests.

### Task 3: Router and persistent shell

**Files:** `App.tsx`, `app/router.tsx`, `app/AppShell.tsx`, `app/useSystem.ts`, `routes/*Page.tsx`, `components/app/*`, `lib` polling helpers and application integration tests.

**Interface:** `createAppRouter()` creates browser router; shell Outlet context shares System state and connectivity only; page queries retain existing query keys.

- [x] Add failing jsdom tests through real App and fetch boundary: route destinations, navigation/history/current item, overview limits, authentication gate and invalidation.
- [x] Add lifecycle tests for one SSE across switches, stable QueryClient/cache/CPU trend, exclusive polling, background recovery and offline/paused data.
- [x] Install `@tanstack/react-router` without unrelated upgrades.
- [x] Implement root shell, local shared hooks and exclusive route components; refresh active queries and restart the sole stream.
- [x] Add fixed four-column navigation with active border/background/font and aria-current, visible focus, 44px targets and safe-area padding.
- [x] Run `npm test` and `npm run build`.

### Task 4: Integration validation and documentation

**Files:** `README.md`, `AGENTS.md` current-state facts and a concise validation report.

- [x] Review backend and frontend changes independently, resolve concrete findings and rerun affected checks. Delayed recovery tests failed before the fix and passed afterward.
- [x] Run frontend/Go checks and XML validation.
- [ ] Complete Docker build, image smoke checks and compose validation: all three commands were attempted; this Mac has no `docker` executable.
- [x] Check 320×740, 390×844 and 844×390, emulated iPhone safe-area insets, production frontend handler deep links, history and token login/refresh using a local synthetic fixture.
- [x] Record actual results and environment limits; never label local fixtures as live host validation.
- [x] Keep changes reviewable in the current workspace without pushing, publishing or changing existing validation evidence.
