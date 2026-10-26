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

// selectInterface uses the actual native select change boundary.
async function selectInterface(host: HTMLElement, value: string) {
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="Network interface"], select#network-interface');
  expect(select, "labelled network interface select").not.toBeNull();
  await act(async () => {
    select!.value = value;
    select!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
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
    expect(app.host.querySelector<HTMLSelectElement>("select")?.value).toBe("eth0");
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
    expect(app.host.querySelector<HTMLSelectElement>("select")?.value).toBe("eth0");
    expect(app.host.textContent).toMatch(/unavailable/i);
    expect(app.host.textContent).not.toContain("2.0 MiB/s");
    expect(app.host.textContent).not.toContain("1.0 KiB/s");
    expect(app.host.querySelector('svg[aria-label*="Receive"] polyline')?.getAttribute("points"))
      .toBe("0.0,0.0 50.0,0.0");
    await app.emit(networkSample(4));
    expect(app.host.querySelector<HTMLSelectElement>("select")?.value).toBe("eth0");
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
    expect(app.host.textContent).toContain("Network · eth0");
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
    expect(app.host.querySelector<HTMLSelectElement>("select")?.value).toBe("eth0");
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
    expect(app.host.querySelector<HTMLSelectElement>("select")?.value).toBe("eth0");
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
    expect(app.host.querySelector("select")).toBeNull();
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
    expect(app.host.querySelector<HTMLSelectElement>("select")?.value).toBe("");
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
    expect(fresh.host.querySelector<HTMLSelectElement>("select")?.value).toBe("");
    expect(fresh.host.querySelector('svg[aria-label*="Receive"]')).toBeNull();
  } finally { await fresh.dispose(); }
});
