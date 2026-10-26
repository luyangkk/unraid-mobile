# Compact Network Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved compact interface selector and network telemetry layout.

**Architecture:** Keep selection and trends in the existing AppShell/useSystem.
Add a feature-local selector that owns only sheet visibility and trigger focus.
SystemPanel continues to receive the existing snapshot and callbacks.

**Tech Stack:** React 19, TypeScript, Tailwind v4, existing Button/AppSheet, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-network-layout-design.md`

## Global Constraints

- Frontend-only change; no new dependencies or host/API behavior.
- Existing theme tokens and secondary Button; minimum 44px controls.
- Long interface names truncate only in the header and wrap in the sheet.
- Preserve Shell-owned selection, one SSE, old-server Auto, stale samples,
  zero-based shared network scale, gaps and CPU history.
- Selection dismisses immediately and restores trigger focus.
- English code comments and documentation; function-level comments for new code.

## Review Focus

- Auto route missing while manual interfaces remain readable.
- Selected interface disappears while the dialog is open.
- Theme changes and live sampling during selection preserve focus.
- Current choice activation must close without clearing existing trends.
- System becoming unavailable must not leave a dialog over the unavailable card.

---

### Task 1: Compact selector and network presentation

**Files:**
- Create: `web/src/features/system/NetworkInterfaceSelector.tsx`
- Modify: `web/src/features/system/SystemPanel.tsx`
- Test: `web/src/features/system/SystemPanel.test.tsx`
- Test: `web/src/app/network.test.tsx`
- Test: `web/src/App.test.tsx` (initial lazy-route readiness before gesture input)
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: existing `SystemSnapshot`, `NetworkInterfaceSnapshot`,
  `networkSelection: string | null`, `onNetworkSelectionChange`.
- Produces: feature-local `NetworkInterfaceSelector` with snapshot, selection,
  selectedNetwork and onSelectionChange props; no change to SystemPanel props.

- [x] Add failing tests for the named compact selector, UTC sample display,
  dialog point selection/dismissal, full names, unavailable reasons, current
  choice closure and collection loss. Migrate existing app tests to actual
  dialog/radio interaction while retaining SSE and trend assertions.
- [x] Run `npm test -- src/features/system/SystemPanel.test.tsx src/app/network.test.tsx`;
  expect failures for the missing trigger/dialog.
- [x] Implement the selector with existing Button/AppSheet and native radios,
  immediate selection/dismissal and returnFocusRef. Render it only when System
  is available; derive current options from each snapshot.
- [x] Align metric numbers/units, graph placeholders and network baselines.
  Display compact UTC date/time without changing trend calculations.
- [x] Run the targeted tests; expect all green.
- [x] Synchronize AGENTS with the approved interface selection UI.
- [x] Run `npm test` and `npm run build`; expect all tests and PWA checks green.
- [x] Inspect 320/390/448px dark/light renders, long names and focus return with
  a local synthetic API, then run the Impeccable detector over changed UI files.
- [x] Perform one fresh code review; fix material findings and verify as needed.
- [x] Leave reviewable changes on the current feature branch, without publishing.

## Execution notes

- The user requested implementation of the approved approach; no second approval
  gate was added. Changes remain in the existing feature checkout.
- Final review was an author review because the session exposed no subagent tool.
- Two full-suite runs exposed a timing-sensitive first lazy-route gesture test;
  the same file passed on its own. Its setup now waits for the Docker page before
  sending a gesture, retaining all original scrolling/navigation assertions.
- Browser validation uses the production build and local synthetic API/SSE.
- Final evidence: 459/459 tests across 33 files; production/PWA build passed;
  six viewport/theme checks and four interaction checks passed; detector returned
  an empty findings array. See `docs/validation/2026-10-26-network-layout.md`.
