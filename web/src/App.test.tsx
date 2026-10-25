// @vitest-environment jsdom
import { onlineManager } from "@tanstack/react-query";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { dockerSample, mountApp, settle, storageSample, systemSample } from "./test/app-fixtures";

describe("primary pages", () => {
  it.each([
    ["/", "Home"], ["/docker", "Docker"], ["/vm", "VM"], ["/storage", "Storage"],
  ])("renders %s with its current navigation item", async (path, label) => {
    const app = await mountApp(path);
    try {
      expect(app.host.querySelector('nav a[aria-current="page"]')?.textContent).toBe(label);
      expect(app.host.textContent).toContain("Tower");
      if (path === "/docker") {
        expect(app.host.textContent).toContain("Stopped (1)");
        expect(app.host.textContent).toContain("Backup");
        expect(app.host.textContent).not.toContain("Assigned CPU");
      }
      if (path === "/vm") expect(app.host.textContent).toContain("Windows");
      if (path === "/storage") expect(app.host.textContent).toContain("disk1");
    } finally { await app.dispose(); }
  });

  it("shows a Not Found page and a Home entry for unknown URLs", async () => {
    const app = await mountApp("/missing");
    try {
      expect(app.host.textContent).toContain("Not Found");
      expect(app.host.querySelector('a[href="/"]')?.textContent).toContain("Home");
      expect(app.host.querySelector('nav a[aria-current="page"]')).toBeNull();
    } finally { await app.dispose(); }
  });

  it("limits Home to running resources and storage summaries", async () => {
    const app = await mountApp();
    try {
      expect(app.host.textContent).toContain("Plex");
      expect(app.host.textContent).toContain("Linux");
      for (const omitted of ["Backup", "Database", "Windows", "disk1", "Storage fixture diagnostic"])
        expect(app.host.textContent).not.toContain(omitted);
      for (const path of ["/docker", "/vm", "/storage"])
        expect(app.host.querySelector(`main a[href="${path}"]`)).not.toBeNull();
    } finally { await app.dispose(); }
  });

  it("supports navigation and browser back/forward without replacing the live shell", async () => {
    const app = await mountApp();
    try {
      await app.navigate("Docker");
      await app.navigate("Storage");
      expect(window.location.pathname).toBe("/storage");
      await act(async () => window.history.back());
      await settle();
      expect(window.location.pathname).toBe("/docker");
      expect(app.host.textContent).toContain("Backup");
      await act(async () => window.history.forward());
      await settle();
      expect(app.host.textContent).toContain("disk1");
      expect(app.host.querySelector('nav a[aria-current="page"]')?.textContent).toBe("Storage");
      expect(app.requests.filter(({ url }) => url.endsWith("/events"))).toHaveLength(1);
      expect(app.requests.filter(({ url }) => url.endsWith("/capabilities"))).toHaveLength(1);
    } finally { await app.dispose(); }
  });

  it("retains QueryClient cache and CPU trend across detail pages", async () => {
    const app = await mountApp();
    try {
      await app.emit({ ...systemSample, timestamp: "2026-10-24T00:00:01Z", cpuUsage: 50 });
      const trend = app.host.querySelector("polyline")?.getAttribute("points");
      expect(trend).toBeTruthy();
      app.client.setQueryData(["retained"], "session marker");
      app.responses.set("/api/v1/docker", new Promise<Response>(() => {}));
      await app.navigate("Docker");
      expect(app.host.textContent).toContain("Plex");
      expect(app.client.getQueryData(["retained"])).toBe("session marker");
      expect(app.client.getQueryData(["docker"])).toEqual(dockerSample);
      await app.navigate("Home");
      expect(app.host.querySelector("polyline")?.getAttribute("points")).toBe(trend);
      expect(app.requests.filter(({ url }) => url.endsWith("/events"))).toHaveLength(1);
    } finally { await app.dispose(); }
  });

  it.each(["Home", "Docker", "VM", "Storage"])("keeps old data visibly stale when offline on %s", async (page) => {
    const app = await mountApp();
    try {
      await app.navigate(page);
      await act(async () => window.dispatchEvent(new Event("offline")));
      await settle();
      expect(app.host.textContent).toContain("Showing the last sample");
      expect(app.host.textContent).toContain("Sampled");
      expect(app.host.querySelector(".opacity-60")).not.toBeNull();
      expect(app.host.textContent).toContain(page === "VM" ? "Linux" : page === "Storage" ? "disk1" : "Plex");
    } finally {
      await act(async () => window.dispatchEvent(new Event("online")));
      await app.dispose();
    }
  });

  it("polls only the visible route at the original interval without duplicating Home observers", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const app = await mountApp();
    try {
      app.requests.length = 0;
      await act(async () => vi.advanceTimersByTimeAsync(6000));
      expect(app.requests.filter(({ url }) => url.endsWith("/docker"))).toHaveLength(3);
      expect(app.requests.filter(({ url }) => url.endsWith("/storage"))).toHaveLength(3);
      expect(app.requests.filter(({ url }) => url.endsWith("/vms"))).toHaveLength(2);
      await app.navigate("Docker");
      app.requests.length = 0;
      await act(async () => vi.advanceTimersByTimeAsync(6000));
      expect(app.requests.map(({ url }) => url)).toEqual([
        "/api/v1/docker", "/api/v1/docker", "/api/v1/docker",
      ]);
      await app.navigate("VM");
      app.requests.length = 0;
      await act(async () => vi.advanceTimersByTimeAsync(6000));
      expect(app.requests.map(({ url }) => url)).toEqual(["/api/v1/vms", "/api/v1/vms"]);
      await app.navigate("Storage");
      app.requests.length = 0;
      await act(async () => vi.advanceTimersByTimeAsync(6000));
      expect(app.requests.map(({ url }) => url)).toEqual([
        "/api/v1/storage", "/api/v1/storage", "/api/v1/storage",
      ]);
    } finally { await app.dispose(); vi.useRealTimers(); }
  });

  it("pauses background polling and refreshes snapshots before reopening the foreground stream", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const app = await mountApp();
    try {
      const streamSignal = app.requests.find(({ url }) => url.endsWith("/events"))?.signal;
      let hidden = true;
      vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
      await act(async () => document.dispatchEvent(new Event("visibilitychange")));
      app.requests.length = 0;
      await act(async () => vi.advanceTimersByTimeAsync(6000));
      expect(app.requests).toHaveLength(0);
      expect(streamSignal?.aborted).toBe(true);
      expect(app.host.textContent).toContain("Updates paused");
      expect(app.host.querySelectorAll(".opacity-60")).toHaveLength(4);
      hidden = false;
      await act(async () => document.dispatchEvent(new Event("visibilitychange")));
      await settle();
      for (const suffix of ["/docker", "/vms", "/storage"])
        expect(app.requests.filter(({ url }) => url.endsWith(suffix))).toHaveLength(1);
      const urls = app.requests.map(({ url }) => url);
      expect(urls.indexOf("/api/v1/system")).toBeLessThan(urls.indexOf("/api/v1/events"));
      expect(app.requests.filter(({ url }) => url.endsWith("/events"))).toHaveLength(1);
    } finally { await app.dispose(); vi.useRealTimers(); }
  });

  it.each(["/", "/docker", "/vm", "/storage"])("retains cached samples while a Query is paused at %s", async (path) => {
    const app = await mountApp(path);
    try {
      await act(async () => onlineManager.setOnline(false));
      await act(async () => { void app.client.refetchQueries({ type: "active" }); });
      await settle();
      expect(app.client.isFetching()).toBe(0);
      expect(app.host.textContent).toContain("Sampled");
      expect(app.host.querySelector(".opacity-60")).not.toBeNull();
      expect(app.host.textContent).toContain(path === "/vm" ? "Linux" : path === "/storage" ? "disk1" : "Plex");
    } finally {
      await act(async () => onlineManager.setOnline(true));
      await app.dispose();
    }
  });

  it("keeps full data and sample time when refresh fails after navigation", async () => {
    const app = await mountApp();
    try {
      app.responses.set("/api/v1/storage", new Response(JSON.stringify({
        error: { code: "REQUEST_FAILED", message: "Storage proxy unavailable", retryable: false },
      }), { status: 503 }));
      await app.navigate("Storage");
      expect(app.host.textContent).toContain("Storage proxy unavailable");
      expect(app.host.textContent).toContain("disk1");
      expect(app.host.textContent).toContain("Sampled");
      expect(app.host.querySelector(".opacity-60")).not.toBeNull();
    } finally { await app.dispose(); }
  });

  it("retains stale treatment until a delayed foreground snapshot arrives", async () => {
    const app = await mountApp("/docker");
    try {
      let finish: (response: Response) => void = () => {};
      app.responses.set("/api/v1/docker", new Promise<Response>((resolve) => { finish = resolve; }));
      let hidden = true;
      vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
      await act(async () => document.dispatchEvent(new Event("visibilitychange")));
      hidden = false;
      await act(async () => document.dispatchEvent(new Event("visibilitychange")));
      await settle();
      expect(app.host.textContent).toContain("Plex");
      expect(app.host.textContent).toContain("Sampled");
      expect(app.host.querySelector(".opacity-60")).not.toBeNull();
      await act(async () => finish(new Response(JSON.stringify({
        ...dockerSample, timestamp: "2026-10-24T00:00:05Z",
      }))));
      await settle();
      expect(app.host.textContent).not.toContain("Sampled");
      expect(app.host.querySelector(".opacity-60")).toBeNull();
    } finally { await app.dispose(); }
  });

  it("marks cached detail data stale until its first route refresh finishes", async () => {
    const app = await mountApp();
    try {
      let finish: (response: Response) => void = () => {};
      app.responses.set("/api/v1/storage", new Promise<Response>((resolve) => { finish = resolve; }));
      await app.navigate("Storage");
      expect(app.host.textContent).toContain("disk1");
      expect(app.host.textContent).toContain("Sampled");
      expect(app.host.querySelector(".opacity-60")).not.toBeNull();
      await act(async () => finish(new Response(JSON.stringify(storageSample))));
      await settle();
      expect(app.host.querySelector(".opacity-60")).toBeNull();
    } finally { await app.dispose(); }
  });

  it("cancels a pending page request when its route stops using that query", async () => {
    const app = await mountApp();
    try {
      app.responses.set("/api/v1/storage", new Promise<Response>(() => {}));
      await app.navigate("Storage");
      const pending = app.requests.filter(({ url }) => url.endsWith("/storage")).at(-1);
      expect(pending?.signal?.aborted).toBe(false);
      await app.navigate("Docker");
      expect(pending?.signal?.aborted).toBe(true);
      expect(app.client.getQueryData(["storage"])).toEqual(storageSample);
    } finally { await app.dispose(); }
  });

  it.each(["Docker", "VM", "Storage"])("unmounts routed content and all transports when the token expires on %s", async (page) => {
    sessionStorage.setItem("unraid-mobile.app-token", "disposable-browser-fixture");
    const app = await mountApp();
    try {
      await app.navigate(page);
      expect(app.host.querySelector('[aria-label="Clear token"]')).not.toBeNull();
      app.responses.set("/api/v1/capabilities", new Response(JSON.stringify({
        error: { code: "UNAUTHORIZED", message: "Authentication required", retryable: false },
      }), { status: 401 }));
      await act(async () => { await app.client.refetchQueries({ queryKey: ["capabilities"] }); });
      await settle();
      expect(app.host.querySelector("nav")).toBeNull();
      expect(app.host.textContent).toContain("Authentication required");
      expect(app.client.getQueryCache().getAll()).toHaveLength(0);
      expect(sessionStorage.getItem("unraid-mobile.app-token")).toBeNull();
      expect(app.requests.find(({ url }) => url.endsWith("/events"))?.signal?.aborted).toBe(true);
    } finally { await app.dispose(); }
  });
});
