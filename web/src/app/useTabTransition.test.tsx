// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountApp, settle, systemSample } from "../test/app-fixtures";
import { swipe } from "../test/touch";
import * as routerModule from "./router";
import { setTheme } from "../lib/theme";

const restoreRoutes: (() => void)[] = [];

// deferred lets tests separate browser capture, DOM update and visual completion.
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// nativeBrowser models the public ViewTransition lifecycle around the real Router.
function nativeBrowser(mode: "normal" | "throw" | "reject" | "capture-held" | "callback-held" | "reject-before-update" = "normal") {
  const handles: {
    ready: ReturnType<typeof deferred>; finished: ReturnType<typeof deferred>;
    update: Promise<void>; release: () => void; skip: ReturnType<typeof vi.fn>; skipCount: number; old: string; next?: string;
  }[] = [];
  vi.stubGlobal("CSS", { supports: () => true });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { x: 20, y: this.tagName === "NAV" ? 680 : 100, top: this.tagName === "NAV" ? 680 : 100,
      left: 20, right: 370, bottom: 680, width: 350, height: 580, toJSON() {} };
  });
  const start = vi.fn((callback: () => Promise<void>) => {
    if (mode === "throw") throw new Error("Native capture unavailable");
    const ready = deferred();
    const finished = deferred();
    const capture = deferred();
    const handle = { ready, finished, old: document.querySelector("main")!.textContent!, update: Promise.resolve(),
      release: capture.resolve,
      skipCount: 0, skip: vi.fn(() => { handle.skipCount++; ready.reject(new Error("Skipped")); finished.resolve(); }),
      next: undefined as string | undefined };
    if (mode === "reject-before-update") queueMicrotask(() => ready.reject(new Error("Early capture rejection")));
    handle.update = (mode === "callback-held" || mode === "reject-before-update" ? capture.promise : Promise.resolve())
      .then(callback).then(() => {
      handle.next = document.querySelector("main")!.textContent!;
      if (mode === "reject") ready.reject(new Error("Capture failed"));
      else if (mode !== "capture-held" && mode !== "reject-before-update") ready.resolve();
    });
    handles.push(handle);
    return { ready: ready.promise, updateCallbackDone: handle.update, finished: finished.promise, skipTransition: handle.skip };
  });
  Object.defineProperty(document, "startViewTransition", { configurable: true, value: start });
  return { start, handles };
}

// captureRouter retains the public Router instance to verify navigation boundaries.
function captureRouter(loader?: () => Promise<void>) {
  const create = routerModule.createAppRouter;
  let router!: ReturnType<typeof create>;
  vi.spyOn(routerModule, "createAppRouter").mockImplementationOnce(() => {
    router = create();
    if (loader) {
      const options = router.routesById["/vm"].options;
      const previous = options.loader;
      options.loader = loader;
      restoreRoutes.push(() => { options.loader = previous; });
    }
    return router;
  });
  return () => router;
}

afterEach(() => {
  restoreRoutes.splice(0).forEach((restore) => restore());
  Reflect.deleteProperty(document, "startViewTransition");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Tab transition transactions", () => {
  it("cancels native visuals on an OS palette change without enabling reduced motion", async () => {
    localStorage.setItem("unraid-mobile.theme", "system");
    const media = new EventTarget() as MediaQueryList;
    Object.defineProperty(media, "matches", { configurable: true, value: true });
    const native = nativeBrowser();
    const app = await mountApp("/", true, false, media);
    try {
      await swipe(app.host.querySelector("main")!);
      await settle();
      expect(document.documentElement.dataset.theme).toBe("dark");
      await act(async () => {
        Object.defineProperty(media, "matches", { configurable: true, value: false });
        media.dispatchEvent(new Event("change"));
      });
      expect(document.documentElement.dataset.theme).toBe("light");
      expect(native.handles[0].skipCount).toBe(1);
      expect(document.documentElement.hasAttribute("data-tab-transition")).toBe(false);
      expect(window.location.pathname).toBe("/docker");
      await swipe(app.host.querySelector("main")!);
      await settle();
      expect(native.handles).toHaveLength(2);
      native.handles[1].finished.resolve();
    } finally { await app.dispose(); }
  });

  it("cancels a captured old palette before changing the root through storage sync", async () => {
    const native = nativeBrowser();
    const app = await mountApp("/", true, false);
    try {
      await swipe(app.host.querySelector("main")!);
      await settle();
      expect(document.documentElement.hasAttribute("data-tab-transition")).toBe(true);
      await act(async () => window.dispatchEvent(new StorageEvent("storage", {
        key: "unraid-mobile.theme", newValue: "light",
      })));
      expect(document.documentElement.dataset.theme).toBe("light");
      expect(native.handles[0].skipCount).toBe(1);
      expect(document.documentElement.hasAttribute("data-tab-transition")).toBe(false);
      expect(window.location.pathname).toBe("/docker");
      expect(app.host.querySelector<HTMLElement>("[data-tab-content]")!.style.opacity).toBe("1");
      await swipe(app.host.querySelector("main")!);
      await settle();
      expect(window.location.pathname).toBe("/vm");
      expect(native.handles).toHaveLength(2);
      native.handles[1].finished.resolve();
    } finally { await app.dispose(); }
  });

  it("finishes submitted navigation without reviving visuals after a pending theme change", async () => {
    const native = nativeBrowser();
    const loading = deferred();
    const getRouter = captureRouter(() => loading.promise);
    const app = await mountApp("/docker", true, false);
    const navigate = vi.spyOn(getRouter(), "navigate");
    try {
      await swipe(app.host.querySelector("main")!);
      await settle();
      expect(app.host.textContent).toContain("Loading page");
      await act(async () => setTheme("light"));
      expect(native.handles[0].skipCount).toBe(1);
      await act(async () => loading.resolve());
      await settle();
      expect(window.location.pathname).toBe("/vm");
      expect(app.host.textContent).toContain("Windows");
      expect(navigate).toHaveBeenCalledTimes(1);
      const content = app.host.querySelector<HTMLElement>("[data-tab-content]")!;
      expect(content.style.opacity).toBe("1");
      expect(content.style.transform).toBe("none");
      expect(document.documentElement.hasAttribute("data-tab-transition")).toBe(false);
    } finally { loading.resolve(); await app.dispose(); }
  });

  it("invalidates an unsubmitted capture callback when its palette changes", async () => {
    const native = nativeBrowser("callback-held");
    const getRouter = captureRouter();
    const app = await mountApp("/", true, false);
    const navigate = vi.spyOn(getRouter(), "navigate");
    try {
      await swipe(app.host.querySelector("main")!);
      await settle();
      await act(async () => { setTheme("light"); native.handles[0].release(); });
      await settle();
      expect(native.handles[0].skipCount).toBe(1);
      expect(navigate).not.toHaveBeenCalled();
      expect(window.location.pathname).toBe("/");
      expect(document.documentElement.hasAttribute("data-tab-transition")).toBe(false);
    } finally { await app.dispose(); }
  });

  it("resets an active Motion fallback immediately when the palette changes", async () => {
    const app = await mountApp("/", true, false);
    try {
      await swipe(app.host.querySelector("main")!);
      await settle();
      const content = app.host.querySelector<HTMLElement>("[data-tab-content]")!;
      expect(Number(content.style.opacity)).toBeLessThan(1);
      await act(async () => setTheme("light"));
      expect(content.style.opacity).toBe("1");
      expect(content.style.transform).toBe("none");
      expect(window.location.pathname).toBe("/docker");
    } finally { await app.dispose(); }
  });

  it.each([
    ["/", -90, "/docker", "1", "-32px", "32px"],
    ["/docker", -90, "/vm", "1", "-32px", "32px"],
    ["/vm", -90, "/storage", "1", "-32px", "32px"],
    ["/docker", 90, "/", "-1", "32px", "-32px"],
    ["/vm", 90, "/docker", "-1", "32px", "-32px"],
    ["/storage", 90, "/vm", "-1", "32px", "-32px"],
  ])("captures %s with swipe %s and signed snapshots", async (from, dx, to, direction, exit, entry) => {
    const native = nativeBrowser();
    const getRouter = captureRouter();
    const app = await mountApp(from, true, false);
    const navigate = vi.spyOn(getRouter(), "navigate");
    try {
      const main = app.host.querySelector("main")!;
      await swipe(main, Number(dx));
      await settle();
      expect(native.start).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledExactlyOnceWith({ to, viewTransition: false });
      expect(native.handles[0].old).not.toBe(native.handles[0].next);
      expect(document.documentElement.getAttribute("data-tab-direction")).toBe(direction);
      expect(document.documentElement.style.getPropertyValue("--tab-exit-x")).toBe(exit);
      expect(document.documentElement.style.getPropertyValue("--tab-enter-x")).toBe(entry);
      expect(app.host.querySelectorAll("main")).toHaveLength(1);
      expect(app.host.querySelector("main")).toBe(main);
      expect(app.host.querySelector('nav a[aria-current="page"]')?.getAttribute("href")).toBe(to);
      expect(app.host.querySelector("[data-tab-content]")?.getAttribute("style")).not.toContain("opacity: 0");
      await act(async () => native.handles[0].finished.resolve());
      await settle();
      expect(document.documentElement.hasAttribute("data-tab-direction")).toBe(false);
      expect(app.requests.filter(({ url }) => url.endsWith("/events"))).toHaveLength(1);
    } finally { await app.dispose(); }
  });

  it.each(["throw", "reject"] as const)("navigates once when native capture %s", async (mode) => {
    const native = nativeBrowser(mode);
    const getRouter = captureRouter();
    const app = await mountApp("/", true, false);
    const navigate = vi.spyOn(getRouter(), "navigate");
    try {
      await swipe(app.host.querySelector("main")!);
      await settle();
      expect(window.location.pathname).toBe("/docker");
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(native.start).toHaveBeenCalledTimes(1);
      await act(async () => { native.handles[0]?.finished.resolve(); });
      await new Promise((resolve) => setTimeout(resolve, 260));
      expect(document.documentElement.hasAttribute("data-tab-direction")).toBe(false);
      expect(app.host.querySelector("[data-tab-content]")?.getAttribute("style")).not.toContain("opacity: 0;");
    } finally { await app.dispose(); }
  });

  it("holds capture until a delayed target renders, then skips at the budget without renavigation", async () => {
    const native = nativeBrowser();
    const loading = deferred();
    const getRouter = captureRouter(() => loading.promise);
    const app = await mountApp("/docker", true, false);
    const navigate = vi.spyOn(getRouter(), "navigate");
    try {
      await swipe(app.host.querySelector("main")!);
      await settle();
      expect(app.host.textContent).toContain("Loading page");
      expect(native.handles[0].next).toBeUndefined();
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 370)); });
      expect(native.handles[0].skip).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(document.documentElement.hasAttribute("data-tab-direction")).toBe(false);
      await act(async () => loading.resolve());
      await settle();
      expect(app.host.textContent).toContain("Windows");
      expect(native.handles[0].next).toContain("Windows");
      expect(navigate).toHaveBeenCalledTimes(1);
    } finally { loading.resolve(); await app.dispose(); }
  });

  it("ignores swipes during native animation but a Link interrupts it and stale finished cannot clear a new transaction", async () => {
    const native = nativeBrowser();
    const app = await mountApp("/", true, false);
    try {
      await swipe(app.host.querySelector("main")!);
      await settle();
      const history = window.history.length;
      await swipe(app.host.querySelector("main")!);
      await settle();
      expect(window.location.pathname).toBe("/docker");
      expect(window.history.length).toBe(history);
      await app.navigate("VM");
      expect(native.handles[0].skip).toHaveBeenCalledTimes(1);
      expect(window.location.pathname).toBe("/vm");
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 260)); });
      await swipe(app.host.querySelector("main")!);
      await settle();
      expect(native.handles).toHaveLength(2);
      await act(async () => native.handles[0].finished.resolve());
      expect(document.documentElement.getAttribute("data-tab-direction")).toBe("1");
      await swipe(app.host.querySelector("main")!, 90);
      await settle();
      expect(window.location.pathname).toBe("/storage");
      native.handles[1].finished.resolve();
    } finally { await app.dispose(); }
  });

  it.each(["unmount", "hidden", "sheet", "resize", "history"] as const)("clears native snapshots on %s", async (reason) => {
    const native = nativeBrowser();
    const app = await mountApp("/", true, false);
    const modal = document.createElement("div");
    modal.setAttribute("data-sheet-content", "");
    let disposed = false;
    try {
      await swipe(app.host.querySelector("main")!);
      await settle();
      await act(async () => {
        if (reason === "hidden") {
          Object.defineProperty(document, "hidden", { configurable: true, value: true });
          document.dispatchEvent(new Event("visibilitychange"));
        } else if (reason === "sheet") document.body.append(modal);
        else if (reason === "resize") window.dispatchEvent(new Event("resize"));
        else if (reason === "history") window.history.back();
      });
      if (reason === "unmount") { await app.dispose(); disposed = true; }
      await settle();
      expect(native.handles[0].skipCount).toBe(1);
      expect(document.documentElement.hasAttribute("data-tab-direction")).toBe(false);
      expect(document.documentElement.style.getPropertyValue("--tab-enter-x")).toBe("");
    } finally {
      Reflect.deleteProperty(document, "hidden");
      modal.remove();
      if (!disposed) await app.dispose();
    }
  });

  it("never captures ordinary navigation, reduced-motion swipes or metric updates", async () => {
    const native = nativeBrowser();
    const app = await mountApp();
    try {
      await app.navigate("Docker");
      await swipe(app.host.querySelector("main")!);
      await settle();
      await app.emit({ ...systemSample, timestamp: "2026-10-25T00:00:01Z" });
      expect(window.location.pathname).toBe("/vm");
      expect(native.start).not.toHaveBeenCalled();
    } finally { await app.dispose(); }
  });

  it.each(["api", "css"] as const)("uses directional entry when native %s support is missing", async (missing) => {
    const native = nativeBrowser();
    if (missing === "api") Reflect.deleteProperty(document, "startViewTransition");
    else vi.stubGlobal("CSS", { supports: () => false });
    const getRouter = captureRouter();
    const app = await mountApp("/", true, false);
    const navigate = vi.spyOn(getRouter(), "navigate");
    try {
      await swipe(app.host.querySelector("main")!);
      await settle();
      expect(window.location.pathname).toBe("/docker");
      expect(native.start).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledExactlyOnceWith({ to: "/docker", viewTransition: false });
      const content = app.host.querySelector<HTMLElement>("[data-tab-content]")!;
      expect(Number(content.style.opacity)).toBeLessThan(1);
      expect(content.style.transform).toContain("translateX");
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 260)); });
      expect(Number(content.style.opacity)).toBe(1);
      expect(content.style.transform).not.toContain("32px");
    } finally { await app.dispose(); }
  });

  it("ends native visuals immediately when reduced motion is enabled live", async () => {
    const native = nativeBrowser();
    const media = new EventTarget() as MediaQueryList;
    Object.defineProperty(media, "matches", { configurable: true, value: false });
    const app = await mountApp("/", true, media);
    try {
      await swipe(app.host.querySelector("main")!);
      await settle();
      await act(async () => {
        Object.defineProperty(media, "matches", { configurable: true, value: true });
        media.dispatchEvent(new Event("change"));
      });
      expect(native.handles[0].skip).toHaveBeenCalledTimes(1);
      expect(document.documentElement.hasAttribute("data-tab-direction")).toBe(false);
      expect(app.host.querySelector<HTMLElement>("[data-tab-content]")!.style.opacity).toBe("1");
      await swipe(app.host.querySelector("main")!);
      await settle();
      expect(window.location.pathname).toBe("/vm");
      expect(native.start).toHaveBeenCalledTimes(1);
    } finally { await app.dispose(); }
  });

  it.each(["width", "top", "scroll"] as const)("skips mismatched %s geometry and enters without displacement", async (change) => {
    const native = nativeBrowser();
    const loading = deferred();
    captureRouter(() => loading.promise);
    const app = await mountApp("/docker", true, false);
    try {
      await swipe(app.host.querySelector("main")!);
      await settle();
      if (change === "scroll") vi.stubGlobal("scrollY", 80);
      else vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
        x: 20, y: change === "top" ? 80 : 100, top: change === "top" ? 80 : 100,
        left: 20, right: 370, bottom: 680, width: change === "width" ? 320 : 350, height: 580, toJSON() {},
      });
      await act(async () => loading.resolve());
      await settle();
      expect(native.handles[0].skip).toHaveBeenCalledTimes(1);
      expect(window.location.pathname).toBe("/vm");
      expect(app.host.querySelector<HTMLElement>("[data-tab-content]")!.style.transform).not.toContain("translateX");
      expect(document.documentElement.hasAttribute("data-tab-direction")).toBe(false);
    } finally { loading.resolve(); await app.dispose(); }
  });

  it("clips the union of short and long snapshots above navigation", async () => {
    const native = nativeBrowser();
    const loading = deferred();
    captureRouter(() => loading.promise);
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      const top = this.tagName === "NAV" ? 680 : 100;
      const bottom = this.tagName === "NAV" ? 740 : 560;
      return { x: 20, y: top, top, left: 20, right: 370, bottom,
        width: 350, height: bottom - top, toJSON() {} };
    });
    const app = await mountApp("/docker", true, false);
    try {
      await swipe(app.host.querySelector("main")!);
      await settle();
      expect(document.documentElement.style.getPropertyValue("--tab-clip-bottom")).toBe(`${window.innerHeight - 560}px`);
      vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
        const top = this.tagName === "NAV" ? 680 : 100;
        const bottom = this.tagName === "NAV" ? 740 : 900;
        return { x: 20, y: top, top, left: 20, right: 370, bottom,
          width: 350, height: bottom - top, toJSON() {} };
      });
      await act(async () => loading.resolve());
      await settle();
      expect(native.handles[0].skip).not.toHaveBeenCalled();
      expect(document.documentElement.style.getPropertyValue("--tab-clip-bottom")).toBe(`${window.innerHeight - 680}px`);
      native.handles[0].finished.resolve();
    } finally { loading.resolve(); await app.dispose(); }
  });

  it.each(["geometry", "deadline", "hidden", "sheet"] as const)("retains %s policy until a pending route commits", async (reason) => {
    const native = nativeBrowser();
    const loading = deferred();
    captureRouter(() => loading.promise);
    const app = await mountApp("/docker", true, false);
    const modal = document.createElement("div");
    modal.setAttribute("data-sheet-content", "");
    try {
      await swipe(app.host.querySelector("main")!);
      await settle();
      if (reason === "deadline") {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 370)); });
      } else if (reason === "hidden") {
        await act(async () => {
          Object.defineProperty(document, "hidden", { configurable: true, value: true });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        Object.defineProperty(document, "hidden", { configurable: true, value: false });
        document.dispatchEvent(new Event("visibilitychange"));
      } else if (reason === "sheet") {
        await act(async () => document.body.append(modal));
        await act(async () => modal.remove());
      }
      await act(async () => {
        window.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new Event("resize"));
      });
      await act(async () => loading.resolve());
      await settle();
      expect(window.location.pathname).toBe("/vm");
      expect(native.handles[0].skipCount).toBe(1);
      const style = app.host.querySelector<HTMLElement>("[data-tab-content]")!.style;
      expect(style.transform).not.toContain("translateX");
      if (reason !== "geometry") expect(style.opacity).toBe("1");
      expect(document.documentElement.hasAttribute("data-tab-transition")).toBe(false);
    } finally {
      Reflect.deleteProperty(document, "hidden");
      modal.remove();
      loading.resolve();
      await app.dispose();
    }
  });

  it("settles a redirected navigation without capturing a wrong target or navigating again", async () => {
    const native = nativeBrowser();
    const getRouter = captureRouter();
    const app = await mountApp("/docker", true, false);
    const { redirect } = await import("@tanstack/react-router");
    getRouter().routesById["/vm"].options.beforeLoad = () => { throw redirect({ to: "/storage" }); };
    const navigate = vi.spyOn(getRouter(), "navigate");
    try {
      await swipe(app.host.querySelector("main")!);
      await settle();
      expect(window.location.pathname).toBe("/storage");
      expect(native.handles[0].skip).toHaveBeenCalledTimes(1);
      expect(document.documentElement.hasAttribute("data-tab-direction")).toBe(false);
      expect(navigate.mock.calls.filter(([options]) => options.to === "/vm")).toHaveLength(1);
      expect(app.host.querySelector('nav a[aria-current="page"]')?.getAttribute("href")).toBe("/storage");
    } finally { delete getRouter().routesById["/vm"].options.beforeLoad; await app.dispose(); }
  });

  it("a superseding Link releases a delayed render waiter and preserves the actual destination", async () => {
    const native = nativeBrowser();
    const loading = deferred();
    const getRouter = captureRouter(() => loading.promise);
    const app = await mountApp("/docker", true, false);
    const navigate = vi.spyOn(getRouter(), "navigate");
    try {
      await swipe(app.host.querySelector("main")!);
      await settle();
      await app.navigate("Storage");
      expect(native.handles[0].skip).toHaveBeenCalledTimes(1);
      await native.handles[0].update;
      await act(async () => loading.resolve());
      await settle();
      expect(window.location.pathname).toBe("/storage");
      expect(navigate.mock.calls.filter(([options]) => options.to === "/vm")).toHaveLength(1);
      expect(document.documentElement.hasAttribute("data-tab-direction")).toBe(false);
    } finally { loading.resolve(); await app.dispose(); }
  });

  it.each(["logout", "401"] as const)("releases protected snapshots on %s", async (reason) => {
    const native = nativeBrowser();
    sessionStorage.setItem("unraid-mobile.app-token", "disposable-transition-test");
    const app = await mountApp("/", true, false);
    try {
      await swipe(app.host.querySelector("main")!);
      await settle();
      if (reason === "logout") {
        await act(async () => app.host.querySelector<HTMLButtonElement>('[aria-label="Clear token"]')!.click());
      } else {
        app.responses.set("/api/v1/docker", new Response(JSON.stringify({
          error: { code: "UNAUTHORIZED", message: "Authentication required", retryable: false },
        }), { status: 401 }));
        await act(async () => { await app.client.invalidateQueries({ queryKey: ["docker"] }); });
      }
      await settle();
      expect(native.handles[0].skip).toHaveBeenCalledTimes(1);
      expect(document.documentElement.hasAttribute("data-tab-direction")).toBe(false);
      expect(app.host.querySelector("[data-tab-content]")).toBeNull();
      expect(app.host.textContent).toContain("API authentication");
      expect(app.client.getQueryData(["docker"])).toBeUndefined();
    } finally { await app.dispose(); }
  });

  it("rejects endpoints before capturing or adding History", async () => {
    const native = nativeBrowser();
    const app = await mountApp("/", true, false);
    try {
      const length = history.length;
      await swipe(app.host.querySelector("main")!, 90);
      await settle();
      expect(history.length).toBe(length);
      expect(native.start).not.toHaveBeenCalled();
      await app.navigate("Storage");
      await swipe(app.host.querySelector("main")!, -90);
      await settle();
      expect(window.location.pathname).toBe("/storage");
      expect(native.start).not.toHaveBeenCalled();
    } finally { await app.dispose(); }
  });

  it("never submits a held native callback after the page is hidden", async () => {
    const native = nativeBrowser("callback-held");
    const getRouter = captureRouter();
    const app = await mountApp("/", true, false);
    const navigate = vi.spyOn(getRouter(), "navigate");
    try {
      await swipe(app.host.querySelector("main")!);
      await settle();
      await act(async () => {
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
        native.handles[0].release();
      });
      await settle();
      expect(navigate).not.toHaveBeenCalled();
      expect(window.location.pathname).toBe("/");
      expect(document.documentElement.hasAttribute("data-tab-direction")).toBe(false);
    } finally { Reflect.deleteProperty(document, "hidden"); await app.dispose(); }
  });

  it("handles early ready rejection while preserving a single eventual navigation", async () => {
    const native = nativeBrowser("reject-before-update");
    const getRouter = captureRouter();
    const app = await mountApp("/", true, false);
    const navigate = vi.spyOn(getRouter(), "navigate");
    try {
      await swipe(app.host.querySelector("main")!);
      await settle();
      expect(document.documentElement.hasAttribute("data-tab-direction")).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
      await act(async () => native.handles[0].release());
      await settle();
      expect(navigate).toHaveBeenCalledExactlyOnceWith({ to: "/docker", viewTransition: false });
      expect(window.location.pathname).toBe("/docker");
      expect(Number(app.host.querySelector<HTMLElement>("[data-tab-content]")!.style.opacity)).toBeLessThan(1);
    } finally { await app.dispose(); }
  });

  it("settles a failed loader on the real Router error UI without a second navigation", async () => {
    const native = nativeBrowser();
    const getRouter = captureRouter(() => Promise.reject(new Error("Fixture route failed")));
    const app = await mountApp("/docker", true, false);
    const navigate = vi.spyOn(getRouter(), "navigate");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await swipe(app.host.querySelector("main")!);
      await settle();
      expect(window.location.pathname).toBe("/vm");
      expect(app.host.textContent).toContain("Something went wrong");
      expect(navigate).toHaveBeenCalledTimes(1);
      await act(async () => native.handles[0].finished.resolve());
      expect(document.documentElement.hasAttribute("data-tab-direction")).toBe(false);
    } finally { error.mockRestore(); warning.mockRestore(); await app.dispose(); }
  });
});
