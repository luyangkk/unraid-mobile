// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createPWARegistration } from "../../lib/pwa";
import { PWAUpdateBanner } from "./PWAUpdateBanner";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(async () => { await act(async () => root.render(null)); });

// mount renders protected-page siblings with the real registration controller.
async function mount(mode: "waiting" | "unsupported" | "error" | "development") {
  const worker = { postMessage: vi.fn() };
  const registration = Object.assign(new EventTarget(), { waiting: worker, installing: null });
  const container = Object.assign(new EventTarget(), {
    register: vi.fn(async () => {
      if (mode === "error") throw new Error("Registration failed");
      return registration as unknown as ServiceWorkerRegistration;
    }),
  });
  const pwa = createPWARegistration({
    production: mode !== "development",
    container: mode === "unsupported" ? undefined : container as unknown as ServiceWorkerContainer,
  });
  await act(async () => root.render(
    <><PWAUpdateBanner registration={pwa} /><main>Application content</main></>,
  ));
  return { worker, container };
}

it.each(["unsupported", "error", "development"] as const)("renders application content when PWA is %s", async (mode) => {
  await mount(mode);
  expect(host.querySelector("main")?.textContent).toBe("Application content");
  expect(host.querySelector('[role="status"]')).toBeNull();
});

it("offers a waiting update with accessible confirm and dismiss controls", async () => {
  const f = await mount("waiting");
  expect(host.querySelector('[role="status"]')?.textContent).toContain("New version available");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Dismiss update"]')!.click());
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(f.worker.postMessage).not.toHaveBeenCalled();
  expect(host.querySelector("main")?.textContent).toBe("Application content");
});

it("confirms through the real controller without navigating immediately", async () => {
  const f = await mount("waiting");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Refresh to update"]')!.click());
  expect(f.worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "SKIP_WAITING" });
  expect(host.querySelector("main")?.textContent).toBe("Application content");
});
