// @vitest-environment jsdom
import { onlineManager } from "@tanstack/react-query";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { dockerSample, mountApp, settle, storageSample, systemSample } from "./test/app-fixtures";
import { pointer, swipe, touchClick } from "./test/touch";
import { animate } from "motion/react";
import * as routerModule from "./app/router";

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  return { ...actual, animate: vi.fn(actual.animate) };
});

describe("primary tab gestures", () => {
  it.each([
    ["/", -90, "/docker"], ["/docker", -90, "/vm"], ["/vm", -90, "/storage"],
    ["/storage", 90, "/vm"], ["/vm", 90, "/docker"], ["/docker", 90, "/"],
  ])("swipes %s by %s to exactly one adjacent route", async (path, dx, destination) => {
    const app = await mountApp(path);
    try {
      const main = app.host.querySelector("main")!;
      await swipe(main, dx);
      await settle();
      expect(window.location.pathname).toBe(destination);
      expect(app.host.querySelector("main")).toBe(main);
      expect(app.host.querySelector(`nav a[href="${destination}"]`)?.getAttribute("aria-current")).toBe("page");
      expect(app.requests.filter(({ url }) => url.endsWith("/events"))).toHaveLength(1);
    } finally { await app.dispose(); }
  });

  it.each([["/", 90], ["/storage", -90]])("consumes a boundary nav swipe at %s without adding history", async (path, dx) => {
    const app = await mountApp(path);
    try {
      const link = app.host.querySelector('nav a[href="/vm"]')!;
      const historyLength = window.history.length;
      await swipe(link, Number(dx));
      expect(await touchClick(link)).toBe(true);
      await settle();
      expect(window.location.pathname).toBe(path);
      expect(window.history.length).toBe(historyLength);
      await app.navigate("VM");
      expect(window.location.pathname).toBe("/vm");
    } finally { await app.dispose(); }
  });

  it("consumes only the swipe click and keeps subsequent taps and keyboard activation", async () => {
    const app = await mountApp();
    try {
      const storage = app.host.querySelector('nav a[href="/storage"]')!;
      await swipe(storage);
      expect(await touchClick(storage)).toBe(true);
      await settle();
      expect(window.location.pathname).toBe("/docker");
      await pointer(storage, "pointerdown", { x: 220, time: 1300 });
      await pointer(storage, "pointerup", { x: 220, time: 1350 });
      expect(await touchClick(storage)).toBe(false);
      await settle();
      expect(window.location.pathname).toBe("/storage");
      await app.navigate("Home");
      expect(window.location.pathname).toBe("/");
    } finally { await app.dispose(); }
  });

  it("consumes legacy touch clicks without swallowing keyboard or unrelated pointer clicks", async () => {
    const app = await mountApp();
    try {
      const storage = app.host.querySelector('nav a[href="/storage"]')!;
      await swipe(storage, 90);
      expect(await touchClick(storage, 1, true)).toBe(true);
      await settle();
      expect(window.location.pathname).toBe("/");
      await swipe(storage, 90);
      await app.navigate("VM");
      expect(window.location.pathname).toBe("/vm");
      await swipe(storage, -90);
      expect(await touchClick(storage, 2)).toBe(false);
      await settle();
      expect(window.location.pathname).toBe("/storage");
    } finally { await app.dispose(); }
  });

  it.each(["vertical", "diagonal", "cancel", "lost", "multi", "mouse", "short", "edge-left", "edge-right"])(
    "rejects %s and still accepts a fresh swipe", async (reason) => {
      const app = await mountApp("/docker");
      try {
        const main = app.host.querySelector("main")!;
        const x = reason === "edge-left" ? 23 : reason === "edge-right" ? window.innerWidth - 23 : 220;
        await pointer(main, "pointerdown", { x, pointerType: reason === "mouse" ? "mouse" : "touch" });
        if (reason === "multi") await pointer(document.body, "pointerdown", { x, id: 2, isPrimary: false });
        if (reason === "vertical") await pointer(main, "pointermove", { x: x - 4, y: 180, time: 1020 });
        await pointer(main, "pointermove", {
          x: x - (reason === "short" ? 20 : 90), y: reason === "diagonal" ? 220 : 150, time: 1100,
        });
        await pointer(main, reason === "cancel" ? "pointercancel" : reason === "lost" ? "lostpointercapture" : "pointerup", {
          x: x - (reason === "short" ? 20 : 90), y: reason === "diagonal" ? 220 : 150,
          time: reason === "short" ? 6000 : 1200,
        });
        if (reason === "multi") await pointer(document.body, "pointerup", { x, id: 2 });
        await settle();
        expect(window.location.pathname).toBe("/docker");
        await swipe(main);
        await settle();
        expect(window.location.pathname).toBe("/vm");
      } finally { await app.dispose(); }
    },
  );

  it("accepts a fast 24px swipe and cancels a gesture when its route changes", async () => {
    const app = await mountApp();
    try {
      const main = app.host.querySelector("main")!;
      await pointer(main, "pointerdown", { x: 220 });
      await pointer(main, "pointermove", { x: 196, time: 1010 });
      await pointer(main, "pointerup", { x: 196, time: 1020 });
      await settle();
      expect(window.location.pathname).toBe("/docker");
      await pointer(main, "pointerdown", { x: 220 });
      await pointer(main, "pointermove", { x: 130, time: 1100 });
      await app.navigate("VM");
      await pointer(main, "pointerup", { x: 130, time: 1200 });
      await settle();
      expect(window.location.pathname).toBe("/vm");
    } finally { await app.dispose(); }
  });

  it.each([-1, 1])("waits for an ambiguous diagonal start to become horizontal in direction %s", async (direction) => {
    const app = await mountApp("/docker");
    try {
      const main = app.host.querySelector("main")!;
      await pointer(main, "pointerdown", { x: 220 });
      await pointer(main, "pointermove", { x: 220 + direction * 12, y: 160, time: 1020 });
      await pointer(main, "pointermove", { x: 220 + direction * 90, y: 160, time: 1100 });
      await pointer(main, "pointerup", { x: 220 + direction * 90, y: 160, time: 1200 });
      await settle();
      expect(window.location.pathname).toBe(direction < 0 ? "/vm" : "/");
    } finally { await app.dispose(); }
  });

  it("locks a clearly vertical gesture after an ambiguous start", async () => {
    const app = await mountApp("/docker");
    try {
      const main = app.host.querySelector("main")!;
      await pointer(main, "pointerdown", { x: 220 });
      await pointer(main, "pointermove", { x: 208, y: 160, time: 1020 });
      await pointer(main, "pointermove", { x: 208, y: 190, time: 1040 });
      await pointer(main, "pointermove", { x: 130, y: 190, time: 1100 });
      await pointer(main, "pointerup", { x: 130, y: 190, time: 1200 });
      await settle();
      expect(window.location.pathname).toBe("/docker");
    } finally { await app.dispose(); }
  });

  it("ignores capture loss from a different pointer during a held touch", async () => {
    const app = await mountApp("/docker");
    try {
      const main = app.host.querySelector("main")!;
      await pointer(main, "pointerdown", { x: 220 });
      await pointer(main, "pointermove", { x: 130, time: 1100 });
      await pointer(document.body, "lostpointercapture", { x: 130, id: 99, time: 1120 });
      await pointer(main, "pointerup", { x: 130, time: 1200 });
      await settle();
      expect(window.location.pathname).toBe("/vm");
    } finally { await app.dispose(); }
  });

  it.each(["button", "a", "summary", "input", "select", "textarea", "editable", "scroller", "header", "outside"])(
    "leaves %s starts to their existing interaction", async (kind) => {
      const app = await mountApp("/docker");
      const node = document.createElement(kind === "editable" || kind === "scroller" || kind === "outside" ? "div" : kind === "header" ? "span" : kind);
      try {
        if (kind === "editable") node.contentEditable = "true";
        if (kind === "editable") node.setAttribute("contenteditable", "true");
        if (kind === "scroller") {
          node.style.overflowX = "auto";
          Object.defineProperties(node, { scrollWidth: { value: 600 }, clientWidth: { value: 300 } });
        }
        (kind === "outside" ? document.body : app.host.querySelector(kind === "header" ? "header" : "main")!).append(node);
        await swipe(node);
        await settle();
        expect(window.location.pathname).toBe("/docker");
      } finally { node.remove(); await app.dispose(); }
    },
  );

  it("ignores unknown routes and computes edge exclusion from the viewport", async () => {
    const app = await mountApp("/missing");
    try {
      await swipe(app.host.querySelector("main")!);
      await settle();
      expect(window.location.pathname).toBe("/missing");
      await app.navigate("Home");
      await swipe(app.host.querySelector("main")!, -90, 290);
      await settle();
      expect(window.location.pathname).toBe("/docker");
    } finally { await app.dispose(); }
  });

  it.each(["background", "logout", "401", "unmount"])("discards held navigation after %s", async (reason) => {
    sessionStorage.setItem("unraid-mobile.app-token", "disposable-touch-fixture");
    const app = await mountApp("/docker");
    let disposed = false;
    try {
      const main = app.host.querySelector("main")!;
      await pointer(main, "pointerdown", { x: 220 });
      await pointer(main, "pointermove", { x: 130, time: 1100 });
      if (reason === "background") {
        let hidden = true;
        vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
        await act(async () => document.dispatchEvent(new Event("visibilitychange")));
        hidden = false;
        await act(async () => document.dispatchEvent(new Event("visibilitychange")));
      } else if (reason === "logout") {
        await act(async () => app.host.querySelector<HTMLButtonElement>('[aria-label="Clear token"]')!.click());
      } else if (reason === "401") {
        app.responses.set("/api/v1/capabilities", new Response(JSON.stringify({
          error: { code: "UNAUTHORIZED", message: "Authentication required", retryable: false },
        }), { status: 401 }));
        await act(async () => { await app.client.refetchQueries({ queryKey: ["capabilities"] }); });
      } else { await app.dispose(); disposed = true; }
      await pointer(document.body, "pointerup", { x: 130, time: 1200 });
      await settle();
      expect(window.location.pathname).toBe(reason === "unmount" ? "/" : "/docker");
      if (reason === "logout" || reason === "401") expect(app.host.querySelector("nav")).toBeNull();
    } finally { if (!disposed) await app.dispose(); }
  });

  it("blocks Sheet Portal gestures and cancels a gesture held across opening and closing", async () => {
    const app = await mountApp("/storage");
    try {
      const main = app.host.querySelector("main")!;
      await pointer(main, "pointerdown", { x: 120 });
      await pointer(main, "pointermove", { x: 210, time: 1100 });
      await act(async () => app.host.querySelector<HTMLButtonElement>('[aria-label="View disk1 details"]')!.click());
      await swipe(document.querySelector("[data-sheet-body]")!, 90, 120);
      await swipe(document.querySelector("[data-sheet-overlay]")!, 90, 120);
      await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close sheet"]')!.click());
      await settle();
      await pointer(main, "pointerup", { x: 210, time: 1200 });
      await settle();
      expect(window.location.pathname).toBe("/storage");
      await swipe(main, 90, 120);
      await settle();
      expect(window.location.pathname).toBe("/vm");
    } finally { await app.dispose(); }
  });

  it("retains a modal content marker throughout the Sheet exit animation", async () => {
    const app = await mountApp("/storage", true, false);
    try {
      await act(async () => app.host.querySelector<HTMLButtonElement>('[aria-label="View disk1 details"]')!.click());
      expect(document.querySelector("[data-sheet-content]")).not.toBeNull();
      await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close sheet"]')!.click());
      expect(document.querySelector("[data-sheet-content]")).not.toBeNull();
      await swipe(app.host.querySelector("main")!, 90, 120);
      await settle();
      expect(window.location.pathname).toBe("/storage");
    } finally { await app.dispose(); }
  });

  it("does not resume a touch after a briefly mounted modal disappears", async () => {
    const app = await mountApp("/docker");
    const modal = document.createElement("div");
    modal.setAttribute("data-sheet-content", "");
    try {
      const main = app.host.querySelector("main")!;
      await pointer(main, "pointerdown", { x: 220 });
      await pointer(main, "pointermove", { x: 130, time: 1100 });
      await act(async () => { document.body.append(modal); modal.remove(); });
      await pointer(main, "pointerup", { x: 130, time: 1200 });
      await settle();
      expect(window.location.pathname).toBe("/docker");
    } finally { modal.remove(); await app.dispose(); }
  });

  it("fades only committed route entries, keeping the same main and stream through history", async () => {
    vi.mocked(animate).mockClear();
    const app = await mountApp("/", true, false);
    try {
      const main = app.host.querySelector("main");
      expect(animate).not.toHaveBeenCalled();
      await swipe(main!);
      await settle();
      expect(animate).toHaveBeenCalledTimes(1);
      await app.emit({ ...systemSample, timestamp: "2026-10-24T00:00:01Z" });
      expect(animate).toHaveBeenCalledTimes(1);
      await app.navigate("Docker");
      expect(animate).toHaveBeenCalledTimes(1);
      await app.navigate("Storage");
      await act(async () => window.history.back());
      await settle();
      expect(app.host.textContent).toContain("Backup");
      await act(async () => window.history.forward());
      await settle();
      expect(app.host.textContent).toContain("disk1");
      expect(app.host.querySelector("main")).toBe(main);
      expect(animate).toHaveBeenCalledTimes(4);
      expect(app.requests.filter(({ url }) => url.endsWith("/events"))).toHaveLength(1);
    } finally { await app.dispose(); }
  });

  it("keeps swipes available with reduced motion without entry animation", async () => {
    vi.mocked(animate).mockClear();
    const app = await mountApp();
    try {
      await swipe(app.host.querySelector("main")!);
      await settle();
      expect(window.location.pathname).toBe("/docker");
      expect(animate).not.toHaveBeenCalled();
    } finally { await app.dispose(); }
  });

  it("uses Router pending UI, ignores additional swipes and permits superseding nav clicks", async () => {
    const create = routerModule.createAppRouter;
    let release = () => {};
    const loading = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(routerModule, "createAppRouter").mockImplementationOnce(() => {
      const router = create();
      router.routesById["/vm"].options.loader = () => loading;
      return router;
    });
    const app = await mountApp("/docker");
    try {
      const main = app.host.querySelector("main")!;
      await swipe(main);
      await settle();
      expect(app.host.textContent).toContain("Loading page");
      await swipe(main);
      await settle();
      expect(window.location.pathname).toBe("/vm");
      await app.navigate("Storage");
      expect(window.location.pathname).toBe("/storage");
      await act(async () => release());
      await settle();
      expect(window.location.pathname).toBe("/storage");
      expect(app.host.querySelector('nav a[aria-current="page"]')?.textContent).toBe("Storage");
    } finally { release(); await app.dispose(); }
  });
});

// runningDetails finds the visible Docker group through its summary label.
function runningDetails(host: HTMLElement): HTMLDetailsElement {
  const summary = [...host.querySelectorAll("summary")].find((node) => node.textContent === "Running (1)");
  if (!summary) throw new Error("Missing Docker Running group");
  return summary.parentElement as HTMLDetailsElement;
}

// toggleRunning delivers the native details event to the real panel.
async function toggleRunning(host: HTMLElement, open: boolean) {
  await act(async () => {
    const details = runningDetails(host);
    details.open = open;
    details.dispatchEvent(new Event("toggle"));
  });
  await settle();
}

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

  it.each([
    ["/", "Home", "Docker"],
    ["/docker", "Docker", "Home"],
  ])("keeps the Running fold independent when leaving %s", async (path, first, second) => {
    const app = await mountApp(path);
    try {
      expect(runningDetails(app.host).open).toBe(true);
      await toggleRunning(app.host, false);
      await app.navigate(second);
      expect(runningDetails(app.host).open).toBe(true);

      await toggleRunning(app.host, false);
      await app.navigate(first);
      expect(runningDetails(app.host).open).toBe(false);
      await toggleRunning(app.host, true);
      await app.navigate(second);
      expect(runningDetails(app.host).open).toBe(false);

      await toggleRunning(app.host, true);
      await app.navigate(first);
      expect(runningDetails(app.host).open).toBe(true);
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
      await swipe(app.host.querySelector("main")!);
      await settle();
      app.requests.length = 0;
      await act(async () => vi.advanceTimersByTimeAsync(6000));
      expect(app.requests.map(({ url }) => url)).toEqual([
        "/api/v1/docker", "/api/v1/docker", "/api/v1/docker",
      ]);
      await swipe(app.host.querySelector("main")!);
      await settle();
      app.requests.length = 0;
      await act(async () => vi.advanceTimersByTimeAsync(6000));
      expect(app.requests.map(({ url }) => url)).toEqual(["/api/v1/vms", "/api/v1/vms"]);
      await swipe(app.host.querySelector("main")!);
      await settle();
      app.requests.length = 0;
      await act(async () => vi.advanceTimersByTimeAsync(6000));
      expect(app.requests.map(({ url }) => url)).toEqual([
        "/api/v1/storage", "/api/v1/storage", "/api/v1/storage",
      ]);
    } finally { await app.dispose(); vi.useRealTimers(); }
  });

  it("opens disk details without extra reads and preserves two-second Storage polling", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const app = await mountApp("/storage");
    try {
      const before = app.requests.length;
      const row = app.host.querySelector<HTMLButtonElement>('[aria-label="View disk1 details"]')!;
      expect(row).not.toBeNull();
      await act(async () => row.click());
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialog.textContent).toContain("Temp 35 °C");
      expect(app.requests).toHaveLength(before);
      app.responses.set("/api/v1/storage", {
        ...storageSample, timestamp: "2026-10-25T00:00:06Z",
        disks: [{ ...storageSample.disks[0], temperature: 42 }],
      });
      app.requests.length = 0;
      await act(async () => vi.advanceTimersByTimeAsync(6000));
      await settle();
      expect(app.requests.map(({ url }) => url)).toEqual([
        "/api/v1/storage", "/api/v1/storage", "/api/v1/storage",
      ]);
      expect(document.querySelector('[role="dialog"]')).toBe(dialog);
      expect(dialog.textContent).toContain("Temp 42 °C");
      expect(dialog.querySelector("time")?.textContent).toBe("2026-10-25T00:00:06Z");
      await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="Close sheet"]')!.click());
      await settle();
      expect(app.requests).toHaveLength(3);
    } finally { await app.dispose(); vi.useRealTimers(); }
  });

  it("forwards offline and failed-refresh freshness into an open disk sheet", async () => {
    const app = await mountApp("/storage");
    try {
      await act(async () => app.host.querySelector<HTMLButtonElement>('[aria-label="View disk1 details"]')!.click());
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
      await act(async () => window.dispatchEvent(new Event("offline")));
      await settle();
      expect(dialog.textContent).toContain("Showing the last sample.");
      expect(dialog.querySelector(".opacity-60")).not.toBeNull();
      app.responses.set("/api/v1/storage", new Response(JSON.stringify({
        error: { code: "REQUEST_FAILED", message: "Storage proxy unavailable", retryable: false },
      }), { status: 503 }));
      await act(async () => window.dispatchEvent(new Event("online")));
      await settle();
      expect(dialog.textContent).toContain("Storage refresh failed.");
      expect(dialog.textContent).toContain("Storage proxy unavailable");
      expect(dialog.querySelector("time")?.textContent).toBe(storageSample.timestamp);
    } finally {
      await act(async () => window.dispatchEvent(new Event("online")));
      await app.dispose();
    }
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
