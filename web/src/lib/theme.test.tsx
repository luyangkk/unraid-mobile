// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { setTheme, useTheme } from "./theme";

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// mountDuringCommit changes browser state between initial render and store subscription.
async function mountDuringCommit(change: () => void, media: MediaQueryList) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("matchMedia", () => media);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  // CommitChange models an OS or other-tab update before React attaches subscriptions.
  function CommitChange() {
    useLayoutEffect(change, []);
    return null;
  }
  // Consumer renders the actual preference while the root uses its resolved appearance.
  function Consumer() {
    const theme = useTheme();
    return <><output>{theme}</output><CommitChange /></>;
  }
  await act(async () => root.render(<Consumer />));
  return {
    host,
    // dispose releases the singleton listener lifecycle between cases.
    async dispose() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

it.each(["storage", "system"])("recovers a %s change before the first subscription", async (source) => {
  const media = new EventTarget() as MediaQueryList;
  Object.defineProperty(media, "matches", { configurable: true, value: true });
  if (source === "system") localStorage.setItem("unraid-mobile.theme", "system");
  const app = await mountDuringCommit(() => {
    if (source === "storage") {
      localStorage.setItem("unraid-mobile.theme", "light");
      window.dispatchEvent(new StorageEvent("storage", { key: "unraid-mobile.theme", newValue: "light" }));
    } else {
      Object.defineProperty(media, "matches", { configurable: true, value: false });
      media.dispatchEvent(new Event("change"));
    }
  }, media);
  try {
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(app.host.textContent).toBe(source === "system" ? "system" : "light");
  } finally { await app.dispose(); }
});

it("retains an in-page choice before subscription when persistence is denied", async () => {
  const media = new EventTarget() as MediaQueryList;
  Object.defineProperty(media, "matches", { value: true });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage denied"); });
  const app = await mountDuringCommit(() => { setTheme("light"); }, media);
  try {
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(app.host.textContent).toBe("light");
  } finally { await app.dispose(); }
});

it("finishes only CSS color transitions when the resolved palette changes", async () => {
  const media = new EventTarget() as MediaQueryList;
  Object.defineProperty(media, "matches", { value: true });
  const app = await mountDuringCommit(() => {}, media);
  class ColorTransition {
    transitionProperty = "color";
    finish = vi.fn();
  }
  vi.stubGlobal("CSSTransition", ColorTransition);
  const color = new ColorTransition();
  const transform = new ColorTransition();
  transform.transitionProperty = "transform";
  const motion = { finish: vi.fn() };
  const animations = vi.fn(() => [color, transform, motion]);
  Object.defineProperty(document, "getAnimations", { configurable: true, value: animations });
  try {
    await act(async () => { setTheme("light"); });
    expect(color.finish).toHaveBeenCalledOnce();
    expect(transform.finish).not.toHaveBeenCalled();
    expect(motion.finish).not.toHaveBeenCalled();
    await act(async () => { setTheme("light"); });
    expect(color.finish).toHaveBeenCalledOnce();
  } finally {
    Reflect.deleteProperty(document, "getAnimations");
    await app.dispose();
  }
});
