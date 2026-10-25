// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountApp, settle, systemSample } from "./test/app-fixtures";

const key = "unraid-mobile.theme";

// choose selects a real radio inside the appearance Portal without closing it.
async function choose(value: string) {
  const radio = document.querySelector<HTMLInputElement>(`input[name="appearance"][value="${value}"]`);
  expect(radio, `Missing ${value} appearance option`).not.toBeNull();
  await act(async () => { radio!.focus(); radio!.click(); });
}

// openAppearance uses the persistent header control.
async function openAppearance(host: HTMLElement) {
  const button = host.querySelector<HTMLButtonElement>('[aria-label="Appearance"]');
  expect(button, "Missing appearance entry").not.toBeNull();
  await act(async () => button!.click());
}

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.querySelector('meta[name="theme-color"]')?.remove();
});

describe("application appearance", () => {
  it("defaults to Dark and updates the root and browser chrome immediately", async () => {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
    const app = await mountApp();
    try {
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(meta.content).toBe("#1D1B1B");
      await openAppearance(app.host);
      expect(document.querySelector<HTMLInputElement>('input[value="dark"]')?.checked).toBe(true);
      await choose("light");
      expect(document.documentElement.dataset.theme).toBe("light");
      expect(meta.content).toBe("#F2F2F2");
      expect(localStorage.getItem(key)).toBe("light");
    } finally { await app.dispose(); }
  });

  it.each(["light", "invalid"])("restores %s preference with a Dark fallback", async (saved) => {
    localStorage.setItem(key, saved);
    const app = await mountApp();
    try {
      expect(document.documentElement.dataset.theme).toBe(saved === "light" ? "light" : "dark");
      await openAppearance(app.host);
      expect(document.querySelector<HTMLInputElement>(`input[value="${saved === "light" ? "light" : "dark"}"]`)?.checked).toBe(true);
    } finally { await app.dispose(); }
  });

  it.each(["getItem", "setItem"] as const)("allows in-page selection when storage %s throws", async (method) => {
    const original = Storage.prototype[method];
    vi.spyOn(Storage.prototype, method).mockImplementation(function (this: Storage, ...args: string[]) {
      if (this === localStorage) throw new DOMException("Storage blocked", "SecurityError");
      return Reflect.apply(original, this, args);
    });
    const app = await mountApp();
    try {
      await openAppearance(app.host);
      await choose("light");
      expect(document.documentElement.dataset.theme).toBe("light");
      expect(document.querySelector<HTMLInputElement>('input[value="light"]')?.checked).toBe(true);
    } finally { await app.dispose(); }
  });

  it("follows system changes only in System mode", async () => {
    const media = new EventTarget() as MediaQueryList;
    Object.defineProperty(media, "matches", { configurable: true, value: false });
    const app = await mountApp("/", true, media);
    try {
      await openAppearance(app.host);
      await choose("system");
      expect(localStorage.getItem(key)).toBe("system");
      expect(document.documentElement.dataset.theme).toBe("light");
      await act(async () => {
        Object.defineProperty(media, "matches", { configurable: true, value: true });
        media.dispatchEvent(new Event("change"));
      });
      expect(document.documentElement.dataset.theme).toBe("dark");
      await choose("light");
      await act(async () => media.dispatchEvent(new Event("change")));
      expect(document.documentElement.dataset.theme).toBe("light");
    } finally { await app.dispose(); }
  });

  it("restores System and synchronizes storage changes without rewriting storage", async () => {
    localStorage.setItem(key, "system");
    const app = await mountApp();
    try {
      expect(document.documentElement.dataset.theme).toBe("dark");
      await openAppearance(app.host);
      expect(document.querySelector<HTMLInputElement>('input[value="system"]')?.checked).toBe(true);
      const write = vi.spyOn(Storage.prototype, "setItem");
      await act(async () => window.dispatchEvent(new StorageEvent("storage", { key, newValue: "light" })));
      expect(document.documentElement.dataset.theme).toBe("light");
      expect(document.querySelector<HTMLInputElement>('input[value="light"]')?.checked).toBe(true);
      expect(write).not.toHaveBeenCalled();
      await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: "other", newValue: "dark" })));
      expect(document.documentElement.dataset.theme).toBe("light");
      await act(async () => window.dispatchEvent(new StorageEvent("storage", { key, newValue: "invalid" })));
      expect(document.documentElement.dataset.theme).toBe("dark");
      await choose("light");
      await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: null })));
      expect(document.documentElement.dataset.theme).toBe("dark");
    } finally { await app.dispose(); }
  });

  it("preserves the Portal, focus, route, folds, trend, cache and single SSE", async () => {
    const app = await mountApp();
    try {
      await app.emit({ ...systemSample, timestamp: "2026-10-25T00:00:01Z", cpuUsage: 50 });
      const trend = app.host.querySelector("polyline")?.getAttribute("points");
      const main = app.host.querySelector("main");
      const details = app.host.querySelector<HTMLDetailsElement>("details")!;
      await act(async () => { details.open = false; details.dispatchEvent(new Event("toggle")); });
      app.client.setQueryData(["theme-retained"], "marker");
      const query = app.client.getQueryCache().find({ queryKey: ["system"] });
      await openAppearance(app.host);
      const dialog = document.querySelector('[role="dialog"]');
      const requests = app.requests.length;
      const stream = app.requests.find(({ url }) => url.endsWith("/events"));
      await choose("light");
      await settle();
      expect(document.querySelector('[role="dialog"]')).toBe(dialog);
      expect(document.activeElement).toBe(document.querySelector('input[value="light"]'));
      expect(app.host.querySelector("main")).toBe(main);
      expect(window.location.pathname).toBe("/");
      expect(details.open).toBe(false);
      expect(app.host.querySelector("polyline")?.getAttribute("points")).toBe(trend);
      expect(app.client.getQueryCache().find({ queryKey: ["system"] })).toBe(query);
      expect(app.client.getQueryData(["theme-retained"])).toBe("marker");
      expect(app.requests).toHaveLength(requests);
      expect(stream?.signal?.aborted).toBe(false);
      expect(app.requests.filter(({ url }) => url.endsWith("/events"))).toHaveLength(1);
      await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close sheet"]')!.click());
      await settle();
      expect(document.activeElement).toBe(app.host.querySelector('[aria-label="Appearance"]'));
    } finally { await app.dispose(); }
  });

  it("applies saved appearance and storage updates to authentication before a router mounts", async () => {
    localStorage.setItem(key, "light");
    const app = await mountApp();
    try {
      app.responses.set("/api/v1/capabilities", new Response(JSON.stringify({
        error: { code: "UNAUTHORIZED", message: "Authentication required", retryable: false },
      }), { status: 401 }));
      await act(async () => { await app.client.refetchQueries({ queryKey: ["capabilities"] }); });
      await settle();
      expect(app.host.querySelector("nav")).toBeNull();
      expect(app.host.textContent).toContain("API authentication");
      expect(document.documentElement.dataset.theme).toBe("light");
      await act(async () => window.dispatchEvent(new StorageEvent("storage", { key, newValue: "dark" })));
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(app.host.textContent).toContain("API authentication");
    } finally { await app.dispose(); }
  });

  it("keeps appearance usable while offline without resuming business transports", async () => {
    const app = await mountApp("/storage");
    try {
      await act(async () => window.dispatchEvent(new Event("offline")));
      await settle();
      await openAppearance(app.host);
      const count = app.requests.length;
      await choose("light");
      expect(app.host.textContent).toContain("Connection lost");
      expect(document.documentElement.dataset.theme).toBe("light");
      expect(app.requests).toHaveLength(count);
    } finally {
      await act(async () => window.dispatchEvent(new Event("online")));
      await app.dispose();
    }
  });
});
