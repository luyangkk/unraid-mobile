# Official Unraid Themes Implementation Plan

> **For agentic workers:** Use executing-plans for theme behavior; dispatching-parallel-agents for the independent color migration.

**Goal:** Implement Dark / Light / System with official neutral surfaces and Unraid orange emphasis.

**Architecture:** Root CSS variables change appearance without replacing application instances. A small external store exposes `useTheme()` and `setTheme()`; head bootstrap applies stored appearance before first paint.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, existing AppSheet and Motion.

**Spec:** `docs/superpowers/specs/2026-10-25-official-themes-design.md`, supplemented by the current user's full requirements.

## Global Constraints

- Default `dark`; key `unraid-mobile.theme`; only `dark|light|system` persist.
- Preserve Router, QueryClient, SessionGate, AppShell, current route, folds, queries, trends and single SSE.
- Follow exact user palette; distinguish official colors from derived values.
- No dependency upgrades, icon edits, business data persistence, new operations, deployment or publishing.
- All new functions have English function comments.

## Review Focus

- Storage access denied: selection still works in the current document.
- System preference changes during a native capture: old screenshot disappears and submitted navigation completes.
- Theme changes inside a Portal: same dialog and focused radio remain mounted.
- Stale data: alpha compositing must retain 4.5:1 small-text contrast.
- Narrow authenticated header: three existing/new controls fit at 320px.

## Task 1: Theme lifecycle and appearance control

**Files:** create `web/src/lib/theme.ts`, `web/src/lib/theme.test.tsx`, `web/src/App.theme.test.tsx`, `web/src/components/app/AppearanceSheet.tsx`; modify `App.tsx`, `AppHeader.tsx`, `useTabTransition.ts`, `index.html`.

**Interfaces:** `ThemePreference = "dark"|"light"|"system"`; `useTheme(): ThemePreference`; `setTheme(value: ThemePreference): void`; `subscribeThemeChange(listener: () => void): () => void` fires before actual root color changes.

- [x] Write failing tests for default/restored/invalid preference, get/set exceptions, system changes and storage events; exercise actual DOM/meta and external subscriptions.
- [x] Verify red with behavior and bootstrap tests; additionally reproduce initial subscription races.
- [x] Implement store, root bootstrap and native radio Sheet. Initialize above SessionGate. Subscribe transition engine to synchronous actual-theme-change notification.
- [x] Verify green; add delayed-native, independent OS preference and Motion transition interruption tests and verify red→green.

## Task 2: Semantic palette migration

**Files:** `styles.css`, all existing presentation files except `AppHeader.tsx`, `AppShell.tsx` and `useTabTransition.ts`; new palette contrast tests.

**Interfaces:** Tailwind semantic utilities for background/foreground/surface/surface-muted/border/text-muted/brand/brand-hover/brand-foreground/brand-text/focus-ring/success/warning/danger/info/chart-line/progress-fill/progress-track and necessary hover/control/tint tokens.

- [x] Fetch pinned official source and write failing contrast/token checks.
- [x] Define tokens and migrate each usage by meaning. Preserve existing stale `.opacity-60` marker with readable theme-aware treatment.
- [x] Verify tests; inventory remaining literal palette utilities and SVG colors.

## Task 3: PWA and delivery verification

**Files:** `web/public/manifest.webmanifest`, `web/scripts/verify-pwa.mjs`, `scripts/verify-image.sh`, `AGENTS.md`, `docs/validation/2026-10-25-official-themes.md`.

- [x] Assert default launch `#1D1B1B` in Manifest and head meta; verify failure before changing values.
- [x] Update expectations and engineering convention.
- [x] Run npm ci, npm test (399 passing), npm run build; attempt docker build and image smoke (both exit 127: Docker unavailable).
- [x] Browser-check both themes/pages/auth/Sheet/offline/update states and layouts; document contrasts and genuine device limitations.
- [x] Fresh independent review of the final diff and fix material findings with regression coverage.

## Remaining external verification

- [ ] Run production image build and smoke on a machine with Docker.
- [ ] Validate iPhone / Android installation, device safe areas, rotation and background recovery.

Local browser and synthetic fixture results do not satisfy these external checks.
