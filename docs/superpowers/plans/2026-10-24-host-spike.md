# Host Capability Spike Implementation Plan

> **For agentic workers:** Use executing-plans and test-driven-development for each implementation task.

**Goal:** Produce independent, bounded, sanitized read-only compatibility results using the production readers on an explicitly authorized Unraid host.

**Architecture:** `internal/spike` owns report projection, per-module orchestration and exit decisions. `cmd/host-spike` assembles production adapters and services. The shell launcher only declares read-only mounts and optional probe settings; production API and capability defaults remain unchanged.

**Tech Stack:** Go 1.24, existing production services/adapters, POSIX shell.

**Spec:** The user's Host Capability Spike requirements in this session.

## Global Constraints

- All writes remain disabled; `writeVerified` is always false.
- Docker and VM are optional, enabled only by an exact `true` value.
- VM uses only `/var/run/libvirt/libvirt-sock-ro`; Docker uses the existing fixed GET requests.
- Report no raw host files, VM XML, Docker inspect, labels, environment, serials or tokens.
- Timeout, partial results and skipped probes must remain distinguishable.
- Existing frontend edits and earlier validation records belong to separate work.

## Review Focus

- An unavailable optional socket cannot suppress required-module results.
- Partial telemetry cannot be silently called complete protocol validation.
- Missing temperature or VM uptime cannot make basic reads fail.
- A successful stat/read cannot prove that a bind mount is read-only or Privileged is disabled.
- Live API observations and earlier reports cannot substitute for running the updated Spike.

## Task 1: Independent report and runner

**Files:** `internal/spike/*`, `cmd/host-spike/*`.

- [x] Add failing tests for missing surfaces, skipped/enabled probes, isolated failures, partial snapshots, cancellation/deadlines, JSON whitelist and exit codes.
- [x] Implement production-service collection with separate module results and bounded contexts.
- [x] Project only allowed metrics, counts, states, diagnostics and resource-field availability.
- [x] Test fixed Docker requests and the libvirt read-only socket boundary using existing adapter coverage and Spike integration tests.

## Task 2: Safe launcher

**Files:** `scripts/run-host-spike.sh`, `scripts/run-host-spike_test.sh`, `compose.yaml`.

- [x] Use a fake Docker executable to assert mounts, opt-in environment handling, missing sockets and exit propagation before implementation.
- [x] Remove privileged and boot mounts from Spike; declare all mounts read-only.
- [x] Make Docker/libvirt mounts conditional so missing optional sockets do not prevent required probes from running.
- [x] Verify shell syntax, launcher contract and Compose YAML assertions. Actual Docker/Compose validation is unavailable without the Docker CLI.

## Task 3: Validation evidence and documentation

**Files:** `docs/validation/2026-10-24-host-spike/report.md`, supporting JSON, `README.md`.

- [x] Attempt authorized execution access, collecting only fixed read-only observations.
- [ ] Run the updated Spike on the target if execution access is available; retain its unmodified JSON and exit code.
- [x] Independently compare WebGUI values and before/after states if accessible. One data disk changed from standby to active; invariant acceptance remains unresolved.
- [x] Record each missing verification explicitly and retain experimental/default-off status where evidence is insufficient.
- [x] Run `gofmt`, `go test -race ./...`, and both requested Go builds before claiming implementation is complete.

## Execution access observed

The target HTTP service is reachable (`/healthz` returns 204). The browser bridge was restored and native WebGUI observations were saved, but SSH port 22 refuses connections and clicking the Terminal entry did not expose an accessible execution session. Updated Spike execution still requires an available host execution channel. No host configuration has been changed to create one.
