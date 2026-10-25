# Tab Directional Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show directional old/new page snapshots after a valid Tab swipe while keeping one real Outlet and normal navigation.

**Architecture:** AppShell owns a transition controller with a generation-scoped transaction and native ViewTransition handle. The controller confirms the target through public Router render events, uses Motion values for entry fallback, and synchronously clears visuals on interruption.

**Tech Stack:** Existing React 19, TanStack Router/Query, Motion, CSS View Transitions, Vitest and Chrome/Playwright.

**Spec:** `docs/superpowers/specs/2026-10-25-tab-directional-transition-task.md`

## Global Constraints

- One real Outlet; no extra business subscriptions, prefetch, query refresh or state store.
- Navigation order comes from `primaryNavigation`; gesture thresholds remain unchanged.
- Old snapshot: 32px opposite direction, 180ms; new: 32px along direction, 240ms; fallback: 220ms; easing `[0.22, 1, 0.36, 1]`; capture budget: 350ms.
- Only swipe requests use native snapshots; clicks and History use entry fallback and interrupt swipes.
- Reduced motion disables position and opacity animation, including live preference changes.
- Main retains flex fill and `pb-8`; a separate animation wrapper fills main without changing vertical scrolling.
- No Go, deployment, dependency upgrade or publishing changes.
- Device compatibility must distinguish browser evidence from untested iPhone Safari/PWA.

## Review Focus

- Superseded or redirected lazy navigation must settle render waiters without replaying the abandoned destination.
- A native ready rejection before/after DOM commit must navigate once and never leave a hidden content layer.
- Old transaction callbacks must not clear a newer transaction's attributes or unlock it.
- Scrolled or resized content must fall back without scaling long snapshots into short pages.
- Logout, 401, Sheet insertion and hidden-page cleanup must synchronously release protected snapshots.

### Task 1: Validate native capture with the real Router

**Files:** Temporary harness and scripts outside the repository; final evidence in `docs/validation/2026-10-25-tab-directional-transition.md`.

**Interfaces:** Public `router.subscribe("onRendered", ...)`, `router.navigate({ to, viewTransition: false })`, `document.startViewTransition`.

- [x] Build a disposable harness using the existing app and real Router. Subscribe before navigation and hold the update callback until the target is rendered and no longer pending.
- [x] Sample actual native old/new animations and confirm different route content, one main/Outlet, and a working bottom click interruption.
- [x] Hold a lazy chunk beyond 350ms, skip capture, and confirm Router pending UI and eventual navigation without a second History entry.

### Task 2: Controller and gesture integration through TDD

**Files:** Create `web/src/app/useTabTransition.ts`, `web/src/app/useTabTransition.test.tsx`; modify `web/src/app/AppShell.tsx`, `web/src/app/useTabSwipe.ts`, `web/src/lib/motion.ts`, `web/src/App.test.tsx`.

**Interfaces:** Export `TabPath`, `TabTransitionRequest`, `TabTransitionController`; `useTabTransition(contentRef, navigationRef)` returns `requestSwipe(request): Promise<void>`, `isBusy(): boolean`, `cancelVisual(): void`, plus `x` and `opacity` Motion values. `useTabSwipe(main, nav, controller)` forwards the release request.

- [x] Write failing tests for six directions, invalid/same/boundary targets, busy rejection, native success, missing API/CSS, synchronous throw, ready rejection and budget expiration; assert rendered route, History count and cleanup.
- [x] Run focused Vitest tests and observe missing directional/native behavior.
- [x] Implement commit-once, public render confirmation, native Promise rejection observers, timed skip, generation guards and pre-visible-frame fallback.
- [x] Add failing interruption tests for clicks, History, redirects, delayed loaders, unmount/logout/401, hidden page, modal insertion/removal, live reduced motion, viewport and scroll changes.
- [x] Implement synchronous visual cleanup and waiter cancellation without canceling the real Router navigation. Preserve existing gesture tracking and compatibility-click suppression.
- [x] Run controller and App tests, then the complete frontend suite.

### Task 3: Native CSS and production browser acceptance

**Files:** Modify `web/src/styles.css`; create `web/scripts/verify-tab-transition.mjs` and `docs/validation/2026-10-25-tab-directional-transition.md`.

**Interfaces:** Controller writes generation-owned root attributes and CSS properties for direction, durations, easing and snapshot clipping.

- [x] Add real browser assertions for native middle frames with six signed directions, independent old/new heights, no main Motion overlap and viewport/navigation clipping.
- [x] Scope native CSS to active transactions, suppress root/group default animations, preserve snapshot aspect ratio, and make the transition overlay nonblocking.
- [x] Check missing native API fallback with real opacity/transform frames; no first-frame flash, no replay on polling, no horizontal overflow at 320px.
- [x] Check slow lazy chunks, normal clicks/History interruption, long/short pages, scroll restoration, resizing and reduced motion in a production build.
- [x] Run `npm test`, `npm run build`, `git diff --check`; obtain an independent final code review and fix material findings.
- [x] Record actual results and remaining iPhone Safari/PWA acceptance; explicitly state Go and image checks were not run.

## Execution Notes

- Actual branch baseline is `4e4e709f59c144744df8460f0d94c560b865fff1`; the relevant source matches the spec's `5ff6f97`.
- Controller coverage lives in `useTabTransition.test.tsx`; the existing 84 App tests remain unchanged.
- Final suite after review fixes: 359 tests in 22 files. TypeScript, production/PWA build and diff checks pass.
- Five added regressions first reproduced the independent review's clipping and pending visual-policy findings, then passed after repair.
- Real browser frames reproduced fallback first-frame flashing; four route layout hooks now arm entry before paint. Public `onRendered` still confirms native capture readiness.
- Final production browser run: 19 checks and 102 assertions pass, no browser errors; its index hash matches the final build.
- Final evidence is recorded in `docs/validation/2026-10-25-tab-directional-transition.md` and its sibling evidence directory.
- History interruption is covered by real-Router tests; production browser checks use normal Link interruption. Real browser background/foreground lifecycle and iPhone Safari/PWA remain unverified.
- The independent whole-branch review identified two material issues, now reproduced and fixed. A follow-up repair-review agent was stopped without a report; do not claim independent re-review approval.
- Work remains local on `feat/tab-directional-transition`, without commit, push, merge, publishing or host changes.
