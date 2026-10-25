import { useSyncExternalStore } from "react";

export type ThemePreference = "dark" | "light" | "system";
const storageKey = "unraid-mobile.theme";
const listeners = new Set<() => void>();
const visualListeners = new Set<() => void>();
let preference: ThemePreference = "dark";
let initialized = false;
let media: MediaQueryList | undefined;
let lastStored: string | null = null;

// validPreference rejects arbitrary stored values without persisting a correction.
function validPreference(value: string | null): ThemePreference {
  return value === "light" || value === "system" ? value : "dark";
}

// applyTheme invalidates screenshots before changing live colors, leaving React mounted.
function applyTheme() {
  const resolved = preference === "system" ? (media?.matches ? "dark" : "light") : preference;
  const root = document.documentElement;
  const paletteChanged = root.dataset.theme !== resolved;
  if (paletteChanged) visualListeners.forEach((listener) => listener());
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", resolved === "dark" ? "#171717" : "#F1ECE3");
  // Resolve colors before paint: interpolating both text and surfaces can lose contrast.
  if (paletteChanged && typeof CSSTransition !== "undefined") {
    for (const animation of document.getAnimations?.() ?? []) {
      if (animation instanceof CSSTransition
        && /color|fill|stroke|box-shadow/.test(animation.transitionProperty)) animation.finish();
    }
  }
}

// initializeTheme recovers preferences before a consumer's first render.
function initializeTheme() {
  if (initialized) return;
  initialized = true;
  media = window.matchMedia("(prefers-color-scheme: dark)");
  lastStored = null;
  try { lastStored = window.localStorage.getItem(storageKey); }
  catch { /* Default to Dark when browser persistence is unavailable. */ }
  preference = validPreference(lastStored);
  applyTheme();
}

// changed notifies React only after the global appearance is consistent.
function changed() {
  applyTheme();
  listeners.forEach((listener) => listener());
}

// systemChanged ignores OS changes when the user explicitly chose a theme.
function systemChanged() {
  if (preference === "system") changed();
}

// storageChanged follows other documents without writing the value back.
function storageChanged(event: StorageEvent) {
  if (event.key !== storageKey && event.key !== null) return;
  if (event.storageArea !== null) {
    try { if (event.storageArea !== window.localStorage) return; }
    catch { return; }
  }
  lastStored = event.key === null ? null : event.newValue;
  preference = validPreference(lastStored);
  changed();
}

// subscribe shares one media/storage listener pair across all appearance consumers.
function subscribe(listener: () => void) {
  initializeTheme();
  if (listeners.size === 0) {
    media?.addEventListener("change", systemChanged);
    window.addEventListener("storage", storageChanged);
    // Recover browser changes during commit without overwriting an unpersisted local choice.
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved !== lastStored) {
        lastStored = saved;
        preference = validPreference(saved);
      }
    } catch { /* Keep the already resolved in-page preference. */ }
    applyTheme();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      media?.removeEventListener("change", systemChanged);
      window.removeEventListener("storage", storageChanged);
      initialized = false;
    }
  };
}

// snapshot keeps preference separate from the system-resolved CSS appearance.
function snapshot() {
  initializeTheme();
  return preference;
}

// setTheme applies selection even when browser persistence is unavailable.
export function setTheme(value: ThemePreference) {
  initializeTheme();
  preference = value;
  try {
    window.localStorage.setItem(storageKey, value);
    lastStored = value;
  } catch { /* Keep this document usable. */ }
  changed();
}

// subscribeThemeChange lets visual resources cancel synchronously before palette replacement.
export function subscribeThemeChange(listener: () => void) {
  visualListeners.add(listener);
  return () => { visualListeners.delete(listener); };
}

// useTheme subscribes without changing the identity of any application container.
export function useTheme() {
  return useSyncExternalStore(subscribe, snapshot, () => "dark" as ThemePreference);
}
