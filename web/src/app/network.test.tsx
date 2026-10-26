// @vitest-environment jsdom
import { act } from "react";
import { expect, it, vi } from "vitest";
import { mountApp, settle, systemSample } from "../test/app-fixtures";

// networkSample represents a complete new-server frame with distinct interface rates.
function networkSample(second: number, auto = "shim-br0", includeEthernet = true) {
  const networkInterfaces = [
    ...(includeEthernet ? [{ name: "eth0", available: true, rxBytesPerSecond: 2097152, txBytesPerSecond: 524288 }] : []),
    { name: "shim-br0", available: true, rxBytesPerSecond: 1024, txBytesPerSecond: 2048 },
  ];
  const entry = networkInterfaces.find((item) => item.name === auto);
  return {
    ...systemSample, timestamp: `2026-10-24T00:00:${String(second).padStart(2, "0")}Z`,
    networkInterface: auto, networkRXRate: entry?.rxBytesPerSecond ?? null,
    networkTXRate: entry?.txBytesPerSecond ?? null, networkInterfaces,
  };
}

// interfaceTrigger reads the current interface from its accessible control.
function interfaceTrigger(host: HTMLElement) {
  return host.querySelector<HTMLButtonElement>('[aria-label^="Network interface:"]');
}

// openInterfaces opens the real AppSheet and reads its current radio group.
async function openInterfaces(host: HTMLElement) {
  const trigger = interfaceTrigger(host);
  expect(trigger, "network interface button").not.toBeNull();
  await act(async () => trigger!.click());
  await settle();
  return document.querySelector<HTMLElement>('[role="dialog"]')!;
}

// selectInterface chooses a radio through the actual modal interaction.
async function selectInterface(host: HTMLElement, value: string) {
  const dialog = await openInterfaces(host);
  const radio = [...dialog.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
    .find((option) => option.value === value);
  expect(radio, "requested interface option").toBeDefined();
  await act(async () => radio!.click());
  await settle();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
}

it("keeps a manual interface and its curves across tabs without a second SSE", async () => {
  const app = await mountApp();
  try {
    await app.emit(networkSample(1));
    await selectInterface(app.host, "eth0");
    expect(app.host.textContent).toContain("2.0 MiB/s");
    await app.emit(networkSample(2));
    const receive = app.host.querySelector('svg[aria-label*="Receive"]');
    expect(receive).not.toBeNull();
    const curve = receive!.outerHTML;
    await app.navigate("Docker");
    await app.navigate("Home");
    expect(interfaceTrigger(app.host)?.textContent).toBe("eth0");
    expect(app.host.querySelector('svg[aria-label*="Receive"]')?.outerHTML).toBe(curve);
    expect(app.requests.filter(({ url }) => url.endsWith("/events"))).toHaveLength(1);
  } finally { await app.dispose(); }
});

it("retains a disappeared manual choice without substituting Auto rates", async () => {
  const app = await mountApp();
  try {
    await app.emit(networkSample(1));
    await selectInterface(app.host, "eth0");
    await app.emit(networkSample(2));
    await app.emit(networkSample(3, "shim-br0", false));
    expect(interfaceTrigger(app.host)?.textContent).toBe("eth0");
    expect(app.host.textContent).toMatch(/unavailable/i);
    expect(app.host.textContent).not.toContain("2.0 MiB/s");
    expect(app.host.textContent).not.toContain("1.0 KiB/s");
    expect(app.host.querySelector('svg[aria-label*="Receive"] polyline')?.getAttribute("points"))
      .toBe("0.0,0.0 50.0,0.0");
    await app.emit(networkSample(4));
    expect(interfaceTrigger(app.host)?.textContent).toBe("eth0");
    expect(app.host.textContent).toContain("2.0 MiB/s");
    await app.emit(networkSample(5));
    expect(app.host.querySelector('svg[aria-label*="Receive"]')).not.toBeNull();
    expect([...app.host.querySelectorAll('svg[aria-label*="Receive"] polyline')].map((line) => line.getAttribute("points")))
      .toEqual(["0.0,0.0 25.0,0.0", "75.0,0.0 100.0,0.0"]);
    expect(app.requests.filter(({ url }) => url.endsWith("/events"))).toHaveLength(1);
  } finally { await app.dispose(); }
});

it("resets Auto history when its resolved interface changes and ignores older frames", async () => {
  const app = await mountApp();
  try {
    await app.emit(networkSample(1));
    await app.emit(networkSample(2));
    expect(app.host.querySelector('svg[aria-label*="Receive"]')).not.toBeNull();
    await app.emit(networkSample(3, "eth0"));
    expect(app.host.querySelector('svg[aria-label*="Receive"]')).toBeNull();
    await app.emit(networkSample(2));
    expect(interfaceTrigger(app.host)?.textContent).toBe("Auto · eth0");
    expect(app.host.textContent).toContain("2.0 MiB/s");
    expect(app.host.textContent).not.toContain("1.0 KiB/s");
    expect(app.host.querySelector('svg[aria-label*="Receive"]')).toBeNull();
    expect(app.client.getQueryData<{ timestamp: string; networkInterface: string }>(["system"]))
      .toMatchObject({ timestamp: "2026-10-24T00:00:03Z", networkInterface: "eth0" });
    await app.emit(networkSample(4, "eth0"));
    expect(app.host.querySelector('svg[aria-label*="Receive"]')).not.toBeNull();
    expect(app.host.textContent).toContain("2.0 MiB/s");
    expect(app.requests.filter(({ url }) => url.endsWith("/events"))).toHaveLength(1);
  } finally { await app.dispose(); }
});

it("seeds only the newly selected interface and rejects duplicate instants", async () => {
  const app = await mountApp();
  try {
    await app.emit(networkSample(1));
    await app.emit(networkSample(2));
    await selectInterface(app.host, "eth0");
    expect(app.host.querySelector('svg[aria-label*="Receive"]')).toBeNull();
    await app.emit({ ...networkSample(2), timestamp: "2026-10-24T00:00:02.000Z" });
    expect(app.host.querySelector('svg[aria-label*="Receive"]')).toBeNull();
    await app.emit(networkSample(3));
    expect(app.host.querySelector('svg[aria-label*="Receive"] polyline')?.getAttribute("points"))
      .toBe("0.0,0.0 100.0,0.0");
    await selectInterface(app.host, "");
    expect(app.host.querySelector('svg[aria-label*="Receive"]')).toBeNull();
    expect(app.host.textContent).toContain("1.0 KiB/s");
    await app.emit(networkSample(4));
    expect(app.host.querySelector('svg[aria-label*="Receive"] polyline')?.getAttribute("points"))
      .toBe("0.0,15.0 100.0,15.0");
    expect(app.requests.filter(({ url }) => url.endsWith("/events"))).toHaveLength(1);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  } finally { await app.dispose(); }
});

it("preserves manual curves through theme changes without reconnecting the stream", async () => {
  const app = await mountApp();
  try {
    await app.emit(networkSample(1));
    await selectInterface(app.host, "eth0");
    await app.emit(networkSample(2));
    const curve = app.host.querySelector('svg[aria-label*="Receive"]')!.outerHTML;
    const signal = app.requests.find(({ url }) => url.endsWith("/events"))?.signal;
    await act(async () => window.dispatchEvent(new StorageEvent("storage", {
      key: "unraid-mobile.theme", newValue: "light",
    })));
    await settle();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(app.host.querySelector('svg[aria-label*="Receive"]')?.outerHTML).toBe(curve);
    expect(interfaceTrigger(app.host)?.textContent).toBe("eth0");
    expect(signal?.aborted).toBe(false);
    expect(app.requests.filter(({ url }) => url.endsWith("/events"))).toHaveLength(1);
  } finally { await app.dispose(); }
});

it("retains curves during background pause and splits a resumed real-time gap", async () => {
  const app = await mountApp();
  try {
    await app.emit(networkSample(1));
    await selectInterface(app.host, "eth0");
    await app.emit(networkSample(2));
    const curve = app.host.querySelector('svg[aria-label*="Receive"]')!.outerHTML;
    const signal = app.requests.find(({ url }) => url.endsWith("/events"))?.signal;
    let hidden = true;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(signal?.aborted).toBe(true);
    expect(app.host.querySelector('svg[aria-label*="Receive"]')?.outerHTML).toBe(curve);
    expect(app.host.textContent).toContain("Showing the last sample");
    let finish!: (response: Response) => void;
    app.responses.set("/api/v1/system", new Promise<Response>((resolve) => { finish = resolve; }));
    const before = app.requests.length;
    hidden = false;
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await settle();
    expect(app.host.querySelector('svg[aria-label*="Receive"]')?.outerHTML).toBe(curve);
    expect(app.host.textContent).toContain("Showing the last sample");
    await act(async () => finish(new Response(JSON.stringify(networkSample(10)))));
    await settle();
    await app.emit(networkSample(11));
    const lines = app.host.querySelectorAll('svg[aria-label*="Receive"] polyline');
    expect([...lines].map((line) => line.getAttribute("points")))
      .toEqual(["0.0,0.0 10.0,0.0", "90.0,0.0 100.0,0.0"]);
    expect(interfaceTrigger(app.host)?.textContent).toBe("eth0");
    const urls = app.requests.slice(before).map(({ url }) => url);
    expect(urls.indexOf("/api/v1/system")).toBeLessThan(urls.indexOf("/api/v1/events"));
    expect(app.requests.filter(({ url }) => url.endsWith("/events"))).toHaveLength(2);
    expect(app.host.textContent).not.toContain("Showing the last sample");
  } finally { await app.dispose(); }
});

it("keeps disconnected history through refresh failure and does not fill the recovery gap", async () => {
  const app = await mountApp();
  try {
    await app.emit(networkSample(1));
    await app.emit(networkSample(2));
    const curve = app.host.querySelector('svg[aria-label*="Receive"]')!.outerHTML;
    app.responses.set("/api/v1/system", new Error("Connection unavailable"));
    await act(async () => app.host.querySelector<HTMLButtonElement>('[aria-label="Refresh status"]')!.click());
    await settle();
    expect(app.host.textContent).toContain("Showing the last sample");
    expect(app.host.querySelector('svg[aria-label*="Receive"]')?.outerHTML).toBe(curve);
    app.responses.set("/api/v1/system", networkSample(10));
    await act(async () => app.host.querySelector<HTMLButtonElement>('[aria-label="Refresh status"]')!.click());
    await settle();
    await app.emit(networkSample(11));
    expect(app.host.querySelectorAll('svg[aria-label*="Receive"] polyline')).toHaveLength(2);
  } finally { await app.dispose(); }
});

it.each(["logout", "401"])("clears protected history and selection after %s, including a new session", async (reason) => {
  sessionStorage.setItem("unraid-mobile.app-token", "network-test-token");
  const app = await mountApp();
  try {
    await app.emit(networkSample(1));
    await selectInterface(app.host, "eth0");
    await app.emit(networkSample(2));
    const signal = app.requests.find(({ url }) => url.endsWith("/events"))?.signal;
    if (reason === "logout") {
      await act(async () => app.host.querySelector<HTMLButtonElement>('[aria-label="Clear token"]')!.click());
    } else {
      app.responses.set("/api/v1/capabilities", new Response("Unauthorized", { status: 401 }));
      await act(async () => { await app.client.refetchQueries({ queryKey: ["capabilities"] }); });
    }
    await settle();
    expect(interfaceTrigger(app.host)).toBeNull();
    expect(app.host.querySelector("svg")).toBeNull();
    expect(app.client.getQueryCache().getAll()).toHaveLength(0);
    expect(signal?.aborted).toBe(true);
    app.responses.set("/api/v1/capabilities", { docker: true, vm: true });
    app.responses.set("/api/v1/system", networkSample(10));
    await act(async () => {
      const input = app.host.querySelector<HTMLInputElement>("#app-token")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "new-network-token");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => app.host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await settle();
    expect(interfaceTrigger(app.host)?.textContent).toBe("Auto · shim-br0");
    expect(app.host.querySelector('svg[aria-label*="Receive"]')).toBeNull();
    await app.emit(networkSample(11));
    expect(app.host.querySelector('svg[aria-label*="Receive"]')).not.toBeNull();
  } finally { await app.dispose(); }
});

it("supports an old server via Auto and clears memory-only selection on remount", async () => {
  const app = await mountApp();
  try {
    await app.emit(networkSample(1));
    await selectInterface(app.host, "eth0");
    await app.emit({ ...systemSample, timestamp: "2026-10-24T00:00:02Z", networkInterfaces: undefined });
    expect(app.host.textContent).not.toContain("1.0 MiB/s");
    await selectInterface(app.host, "");
    expect(app.host.textContent).toContain("1.0 MiB/s");
    await app.emit({ ...systemSample, timestamp: "2026-10-24T00:00:03Z", networkInterfaces: undefined });
    expect(app.host.querySelector('svg[aria-label*="Receive"]')).not.toBeNull();
    await app.emit(networkSample(4));
    await selectInterface(app.host, "eth0");
  } finally { await app.dispose(); }
  const fresh = await mountApp();
  try {
    expect(interfaceTrigger(fresh.host)?.textContent).toBe("Auto · br0");
    expect(fresh.host.querySelector('svg[aria-label*="Receive"]')).toBeNull();
  } finally { await fresh.dispose(); }
});

it("closes a point selection and returns focus without resetting CPU history or opening another stream", async () => {
  const app = await mountApp();
  try {
    await app.emit(networkSample(1));
    await app.emit(networkSample(2));
    const cpu = app.host.querySelector('svg[aria-label*="CPU"]')!.outerHTML;
    await selectInterface(app.host, "eth0");
    expect(document.activeElement).toBe(interfaceTrigger(app.host));
    expect(interfaceTrigger(app.host)?.getAttribute("aria-expanded")).toBe("false");
    expect(app.host.querySelector('svg[aria-label*="CPU"]')?.outerHTML).toBe(cpu);
    expect(app.requests.filter(({ url }) => url.endsWith("/events"))).toHaveLength(1);
  } finally { await app.dispose(); }
});

it("closes the current choice without clearing its existing network curves", async () => {
  const app = await mountApp();
  try {
    await app.emit(networkSample(1));
    await app.emit(networkSample(2));
    const curve = app.host.querySelector('svg[aria-label*="Receive"]')!.outerHTML;
    await selectInterface(app.host, "");
    expect(app.host.querySelector('svg[aria-label*="Receive"]')?.outerHTML).toBe(curve);
    expect(document.activeElement).toBe(interfaceTrigger(app.host));
  } finally { await app.dispose(); }
});

it("keeps live sheet focus across theme changes and updates disappeared interface reasons", async () => {
  const app = await mountApp();
  try {
    await app.emit(networkSample(1));
    await selectInterface(app.host, "eth0");
    const dialog = await openInterfaces(app.host);
    const radio = dialog.querySelector<HTMLInputElement>('input[value="eth0"]')!;
    await act(async () => radio.focus());
    await act(async () => window.dispatchEvent(new StorageEvent("storage", {
      key: "unraid-mobile.theme", newValue: "light",
    })));
    await app.emit(networkSample(2, "shim-br0", false));
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(document.activeElement).toBe(radio);
    expect(radio.checked).toBe(true);
    expect(radio.closest("label")?.textContent).toMatch(/unavailable/i);
    expect(dialog.querySelector('input[value=""]')?.closest("label")?.textContent)
      .toContain("Default route · shim-br0");
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true,
    })));
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(interfaceTrigger(app.host));
  } finally { await app.dispose(); }
});

it("shows full long names and lets manual selection work when Auto has no default route", async () => {
  const app = await mountApp();
  try {
    const name = "very-long-network-interface-name".repeat(8);
    await app.emit({
      ...networkSample(1), networkInterface: "", networkRXRate: null, networkTXRate: null,
      diagnostics: { networkRoute: "Default route unavailable" },
      networkInterfaces: [{ name, available: true, rxBytesPerSecond: 4096, txBytesPerSecond: 0 }],
    });
    const dialog = await openInterfaces(app.host);
    expect(dialog.querySelector('input[value=""]')?.closest("label")?.textContent)
      .toContain("Default route unavailable");
    const radio = [...dialog.querySelectorAll<HTMLInputElement>("input")].find((option) => option.value === name)!;
    expect(radio.getAttribute("aria-label")).toBe(name);
    expect(radio.closest("label")?.textContent).toContain(name);
    await act(async () => radio.click());
    await settle();
    expect(interfaceTrigger(app.host)?.textContent).toBe(name);
    expect(app.host.textContent).toContain("4.0 KiB/s");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  } finally { await app.dispose(); }
});

it("removes an open network sheet when System collection becomes unavailable", async () => {
  const app = await mountApp();
  try {
    await openInterfaces(app.host);
    await app.emit({ ...networkSample(1), available: false, reason: "Missing host mounts" });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.hasAttribute("data-scroll-locked")).toBe(false);
    expect(interfaceTrigger(app.host)).toBeNull();
    expect(app.host.textContent).toContain("Missing host mounts");
  } finally { await app.dispose(); }
});
