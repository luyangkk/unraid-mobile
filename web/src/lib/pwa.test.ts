import { describe, expect, it, vi } from "vitest";
import { createPWARegistration } from "./pwa";

// browser supplies controllable native lifecycle events at the registration boundary.
function browser(waiting = false) {
  const worker = Object.assign(new EventTarget(), { state: "installed", postMessage: vi.fn() });
  const registration = Object.assign(new EventTarget(), {
    waiting: waiting ? worker : null,
    installing: null as typeof worker | null,
  });
  const container = Object.assign(new EventTarget(), {
    controller: {} as ServiceWorker,
    register: vi.fn(async () => registration as unknown as ServiceWorkerRegistration),
  });
  const reload = vi.fn();
  const pwa = createPWARegistration({
    production: true, container: container as unknown as ServiceWorkerContainer, reload,
  });
  return { worker, registration, container, reload, pwa };
}

describe("PWA registration and consent", () => {
  it("registers the root worker once in supported production browsers", async () => {
    const f = browser();
    const changes: string[] = [];
    f.pwa.subscribe(() => changes.push(f.pwa.getSnapshot()));
    await f.pwa.start();
    await f.pwa.start();
    expect(f.container.register).toHaveBeenCalledExactlyOnceWith("/sw.js", { scope: "/", updateViaCache: "none" });
    expect(changes).toEqual(["registering", "ready"]);
  });

  it("stays unsupported without Service Worker support", async () => {
    const pwa = createPWARegistration({ production: true });
    await pwa.start();
    expect(pwa.getSnapshot()).toBe("unsupported");
  });

  it("does not register in development", async () => {
    const f = browser();
    const pwa = createPWARegistration({ production: false, container: f.container as unknown as ServiceWorkerContainer });
    await pwa.start();
    expect(f.container.register).not.toHaveBeenCalled();
    expect(pwa.getSnapshot()).toBe("unsupported");
  });

  it("contains registration failure without rejecting startup or disclosing errors", async () => {
    const f = browser();
    f.container.register.mockRejectedValueOnce(new Error("private error"));
    await expect(f.pwa.start()).resolves.toBeUndefined();
    expect(f.pwa.getSnapshot()).toBe("error");
    expect(f.reload).not.toHaveBeenCalled();
  });

  it("announces a worker already waiting when the page starts", async () => {
    const f = browser(true);
    await f.pwa.start();
    expect(f.pwa.getSnapshot()).toBe("updateAvailable");
    expect(f.worker.postMessage).not.toHaveBeenCalled();
  });

  it("announces an update when an installing worker becomes waiting", async () => {
    const f = browser();
    await f.pwa.start();
    f.registration.installing = f.worker;
    f.worker.state = "installing";
    f.container.dispatchEvent(new Event("controllerchange"));
    f.registration.dispatchEvent(new Event("updatefound"));
    f.worker.state = "installed";
    f.registration.waiting = f.worker;
    f.worker.dispatchEvent(new Event("statechange"));
    expect(f.pwa.getSnapshot()).toBe("updateAvailable");
    expect(f.reload).not.toHaveBeenCalled();
  });

  it("dismisses without activating and ignores controller changes from other tabs", async () => {
    const f = browser(true);
    await f.pwa.start();
    f.pwa.dismiss();
    expect(f.pwa.getSnapshot()).toBe("ready");
    expect(f.worker.postMessage).not.toHaveBeenCalled();
    f.container.dispatchEvent(new Event("controllerchange"));
    expect(f.reload).not.toHaveBeenCalled();
  });

  it("sends activation only after confirmation and reloads on controller change once", async () => {
    const f = browser(true);
    await f.pwa.start();
    f.pwa.update();
    f.pwa.update();
    expect(f.worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "SKIP_WAITING" });
    expect(f.reload).not.toHaveBeenCalled();
    f.container.dispatchEvent(new Event("controllerchange"));
    f.container.dispatchEvent(new Event("controllerchange"));
    expect(f.reload).toHaveBeenCalledOnce();
  });

  it("does not reload on first installation", async () => {
    const f = browser();
    f.container.controller = null as unknown as ServiceWorker;
    await f.pwa.start();
    f.container.dispatchEvent(new Event("controllerchange"));
    expect(f.reload).not.toHaveBeenCalled();
  });

  it("lets a user explicitly refresh after another tab already activated the waiting update", async () => {
    const f = browser(true);
    await f.pwa.start();
    f.registration.waiting = null;
    f.container.dispatchEvent(new Event("controllerchange"));
    expect(f.reload).not.toHaveBeenCalled();
    expect(f.pwa.getSnapshot()).toBe("updateAvailable");
    f.pwa.update();
    f.pwa.update();
    expect(f.reload).toHaveBeenCalledOnce();
    expect(f.worker.postMessage).not.toHaveBeenCalled();
  });
});
