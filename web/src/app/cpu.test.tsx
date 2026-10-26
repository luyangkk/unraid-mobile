// @vitest-environment jsdom
import { act } from "react";
import { expect, it, vi } from "vitest";
import { mountApp, settle, systemSample } from "../test/app-fixtures";
import type { SystemSnapshot } from "../lib/api";

// cpuSample mirrors optional REST/SSE CPU facts using real ordered UTC instants.
function cpuSample(second: number, usage: number | null = 25): SystemSnapshot {
  return { ...systemSample, timestamp: new Date(Date.UTC(2026, 9, 26, 0, 0, second)).toISOString(),
    cpuUsage: usage, cpuInfo: { model: "Test processor", reportedFrequencyHz: 2450000000, logicalCPUCount: 3 },
    cpuLogicalProcessors: [{ id: 0, usage }, { id: 2, usage: null, reason: "Collecting CPU baseline" }, { id: 10, usage: 100 }] };
}

// disclosure locates the CPU summary independently of diagnostics disclosures.
function disclosure(host: HTMLElement) {
  const summary = [...host.querySelectorAll("summary")].find((node) => node.textContent?.startsWith("CPU details"));
  expect(summary, "CPU details summary must exist").toBeDefined();
  return summary!.parentElement as HTMLDetailsElement;
}

// assertSampled checks the CPU-local timestamp and its live or retained-sample emphasis.
function assertSampled(details: HTMLDetailsElement, timestamp: string, display: string, stale = false) {
  const time = details.querySelector("time");
  expect(time, "sampling time must be inside expanded CPU details").not.toBeNull();
  expect(time!.getAttribute("datetime")).toBe(timestamp);
  expect(time!.textContent).toBe(display);
  expect(time!.parentElement?.textContent).toBe(`Sampled ${display}`);
  expect(time!.parentElement?.className).toContain(stale ? "text-stale-text-muted" : "text-text-muted");
  expect(time!.closest("[aria-live]")).toBeNull();
  return time!;
}

// expand exercises the native toggle boundary and explicitly waits for its task.
async function expand(host: HTMLElement) {
  const details = disclosure(host);
  await act(async () => details.querySelector("summary")!.click());
  await settle();
  expect(details.open).toBe(true);
  return details;
}

// chooseWindow preserves real native radio focus during controlled selection.
async function chooseWindow(host: HTMLElement, seconds: number) {
  const radio = host.querySelector<HTMLInputElement>(`input[name="cpu-window"][value="${seconds}"]`);
  expect(radio, "CPU trend window radio").not.toBeNull();
  await act(async () => { radio!.focus(); radio!.click(); });
  await settle();
  return radio!;
}

it("preserves disclosure/radio identity, focus and buffers across samples, repeated selection and themes", async () => {
  const app = await mountApp();
  try {
    await app.emit(cpuSample(1, 0));
    const details = await expand(app.host);
    const time = assertSampled(details, "2026-10-26T00:00:01.000Z", "2026-10-26 00:00:01 UTC");
    const summary = details.querySelector("summary")!;
    await act(async () => summary.focus());
    await app.emit(cpuSample(2, 50));
    expect(assertSampled(details, "2026-10-26T00:00:02.000Z", "2026-10-26 00:00:02 UTC")).toBe(time);
    expect(disclosure(app.host)).toBe(details);
    expect(document.activeElement).toBe(summary);
    const radio = await chooseWindow(app.host, 10);
    const count = app.requests.length;
    const networkCurve = app.host.querySelector('svg[aria-label*="Receive"]')!.outerHTML;
    const cpuCurve = app.host.querySelector('svg[aria-label*="CPU"]')!.outerHTML;
    await chooseWindow(app.host, 10);
    expect(app.host.querySelector('svg[aria-label*="CPU"]')?.outerHTML).toBe(cpuCurve);
    expect(app.host.querySelector('svg[aria-label*="Receive"]')?.outerHTML).toBe(networkCurve);
    await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: "unraid-mobile.theme", newValue: "light" })));
    await app.emit(cpuSample(3, 75));
    expect(assertSampled(details, "2026-10-26T00:00:03.000Z", "2026-10-26 00:00:03 UTC")).toBe(time);
    expect(disclosure(app.host)).toBe(details);
    expect(document.activeElement).toBe(radio);
    expect(radio.checked).toBe(true);
    expect(app.host.textContent).toContain("Last 10s");
    expect(app.requests).toHaveLength(count);
    expect(app.requests.filter(({ url }) => url.endsWith("/events"))).toHaveLength(1);
    expect(window.location.pathname).toBe("/");
    expect(document.documentElement.hasAttribute("data-tab-transition")).toBe(false);
  } finally { await app.dispose(); }
});

it("retains open state, selected window and complete aggregate history across tabs and reset on remount", async () => {
  const app = await mountApp();
  try {
    await app.emit(cpuSample(1));
    await app.emit(cpuSample(2, 50));
    await expand(app.host);
    await chooseWindow(app.host, 30);
    const curve = app.host.querySelector('svg[aria-label*="CPU"]')!.outerHTML;
    for (const tab of ["Docker", "VM", "Storage"]) {
      await app.navigate(tab);
      await app.navigate("Home");
      expect(disclosure(app.host).open).toBe(true);
      expect(app.host.querySelector<HTMLInputElement>('input[name="cpu-window"][value="30"]')?.checked).toBe(true);
      expect(app.host.querySelector('svg[aria-label*="CPU"]')?.outerHTML).toBe(curve);
    }
    expect(app.requests.filter(({ url }) => url.endsWith("/events"))).toHaveLength(1);
    expect(Object.keys(localStorage)).toEqual(["unraid-mobile.docker.runningCollapsed.v1"]);
    expect(sessionStorage.length).toBe(0);
  } finally { await app.dispose(); }
  const fresh = await mountApp();
  try {
    expect(disclosure(fresh.host).open).toBe(false);
    expect(fresh.host.querySelector<HTMLInputElement>('input[name="cpu-window"][value="60"]')?.checked).toBe(true);
    expect(fresh.host.querySelector('svg[aria-label*="CPU"]')).toBeNull();
  } finally { await fresh.dispose(); }
});

it("keeps null/gap breaks, rejects duplicate/out-of-order samples and selects existing offline history", async () => {
  const app = await mountApp();
  try {
    await app.emit(cpuSample(0, 0));
    await app.emit(cpuSample(1, 50));
    await app.emit(cpuSample(2, null));
    await app.emit(cpuSample(3, 100));
    await app.emit(cpuSample(4, 25));
    await app.emit(cpuSample(20, 10));
    await app.emit(cpuSample(21, 20));
    expect(app.host.querySelectorAll('svg[aria-label*="CPU"] polyline')).toHaveLength(3);
    const curve = app.host.querySelector('svg[aria-label*="CPU"]')!.outerHTML;
    await app.emit(cpuSample(21, 90));
    await app.emit(cpuSample(20, 99));
    expect(app.host.querySelector('svg[aria-label*="CPU"]')?.outerHTML).toBe(curve);
    const details = await expand(app.host);
    const time = assertSampled(details, "2026-10-26T00:00:21.000Z", "2026-10-26 00:00:21 UTC");
    await act(async () => window.dispatchEvent(new Event("offline")));
    await settle();
    expect(assertSampled(details, "2026-10-26T00:00:21.000Z", "2026-10-26 00:00:21 UTC", true)).toBe(time);
    const count = app.requests.length;
    await chooseWindow(app.host, 10);
    expect(app.host.querySelectorAll('svg[aria-label*="CPU"] polyline')).toHaveLength(1);
    expect(app.host.textContent).toContain("Showing the last sample");
    expect(disclosure(app.host).closest("section")!.parentElement?.className).not.toContain("opacity");
    expect(disclosure(app.host).closest("section")!.querySelector(".opacity-60")).toBeNull();
    await chooseWindow(app.host, 60);
    expect(app.host.querySelector('svg[aria-label*="CPU"]')?.outerHTML).toBe(curve);
    expect(assertSampled(details, "2026-10-26T00:00:21.000Z", "2026-10-26 00:00:21 UTC", true)).toBe(time);
    expect(app.requests).toHaveLength(count);
  } finally {
    await act(async () => window.dispatchEvent(new Event("online")));
    await app.dispose();
  }
});

it("keeps preferences/focus through refresh failure and recovery while splitting the missing interval", async () => {
  const app = await mountApp();
  try {
    await app.emit(cpuSample(1, 0));
    await app.emit(cpuSample(2, 50));
    const details = await expand(app.host);
    const radio = await chooseWindow(app.host, 30);
    const curve = app.host.querySelector('svg[aria-label*="CPU"]')!.outerHTML;
    const time = assertSampled(details, "2026-10-26T00:00:02.000Z", "2026-10-26 00:00:02 UTC");
    const snapshots = app.requests.filter(({ url }) => url.endsWith("/system")).length;
    const streams = app.requests.filter(({ url }) => url.endsWith("/events")).length;
    let rejectRefresh!: (reason: Error) => void;
    app.responses.set("/api/v1/system", new Promise<Response>((_, reject) => { rejectRefresh = reject; }));
    await act(async () => app.host.querySelector<HTMLButtonElement>('[aria-label="Refresh status"]')!.click());
    await settle();
    expect(assertSampled(details, "2026-10-26T00:00:02.000Z", "2026-10-26 00:00:02 UTC", true)).toBe(time);
    expect(disclosure(app.host)).toBe(details);
    expect(document.activeElement).toBe(radio);
    expect(app.requests.filter(({ url }) => url.endsWith("/system"))).toHaveLength(snapshots + 1);
    expect(app.requests.filter(({ url }) => url.endsWith("/events"))).toHaveLength(streams);
    await act(async () => rejectRefresh(new Error("CPU refresh unavailable")));
    await settle();
    expect(assertSampled(details, "2026-10-26T00:00:02.000Z", "2026-10-26 00:00:02 UTC", true)).toBe(time);
    expect(disclosure(app.host)).toBe(details);
    expect(document.activeElement).toBe(radio);
    expect(app.host.querySelector('svg[aria-label*="CPU"]')?.outerHTML).toBe(curve);
    expect(app.host.textContent).toContain("Showing the last sample");
    expect(app.requests.filter(({ url }) => url.endsWith("/system"))).toHaveLength(snapshots + 1);
    expect(app.requests.filter(({ url }) => url.endsWith("/events"))).toHaveLength(streams);
    app.responses.set("/api/v1/system", cpuSample(10, null));
    await act(async () => app.host.querySelector<HTMLButtonElement>('[aria-label="Refresh status"]')!.click());
    await settle();
    expect(assertSampled(details, "2026-10-26T00:00:10.000Z", "2026-10-26 00:00:10 UTC")).toBe(time);
    expect(document.activeElement).toBe(radio);
    expect(app.requests.filter(({ url }) => url.endsWith("/system"))).toHaveLength(snapshots + 2);
    expect(app.requests.filter(({ url }) => url.endsWith("/events"))).toHaveLength(streams + 1);
    await app.emit(cpuSample(11, 25));
    await app.emit(cpuSample(12, 75));
    expect(assertSampled(details, "2026-10-26T00:00:12.000Z", "2026-10-26 00:00:12 UTC")).toBe(time);
    expect(disclosure(app.host)).toBe(details);
    expect(radio.checked).toBe(true);
    expect(app.host.querySelectorAll('svg[aria-label*="CPU"] polyline')).toHaveLength(2);
    expect(app.host.textContent).not.toContain("Showing the last sample");
  } finally { await app.dispose(); }
});

it("hides unavailable System metrics and independently restarts CPU history on collection recovery", async () => {
  const app = await mountApp();
  try {
    await app.emit(cpuSample(1));
    await app.emit(cpuSample(2));
    await expand(app.host);
    await chooseWindow(app.host, 10);
    await app.emit({ ...cpuSample(3), available: false, reason: "Host unavailable" });
    expect(app.host.textContent).toContain("Host unavailable");
    expect(app.host.querySelector('svg[aria-label*="CPU"]')).toBeNull();
    expect(app.host.querySelector('[role="meter"]')).toBeNull();
    expect(app.host.querySelector('input[name="cpu-window"]')).toBeNull();
    expect([...app.host.querySelectorAll("summary")].some((node) => node.textContent?.startsWith("CPU details"))).toBe(false);
    expect(app.host.textContent).not.toContain("Sampled");
    await app.emit(cpuSample(4, null));
    expect(disclosure(app.host).open).toBe(true);
    assertSampled(disclosure(app.host), "2026-10-26T00:00:04.000Z", "2026-10-26 00:00:04 UTC");
    expect(app.host.querySelector<HTMLInputElement>('input[value="10"]')?.checked).toBe(true);
    expect(app.host.querySelector('svg[aria-label*="CPU"]')).toBeNull();
    await app.emit(cpuSample(5));
    await app.emit(cpuSample(6));
    expect(app.host.querySelector('svg[aria-label*="CPU"]')).not.toBeNull();
  } finally { await app.dispose(); }
});

it.each(["logout", "401"])("clears preferences and protected CPU history after %s before a new session", async (reason) => {
  sessionStorage.setItem("unraid-mobile.app-token", "cpu-test-token");
  const app = await mountApp();
  try {
    await app.emit(cpuSample(1));
    await app.emit(cpuSample(2));
    await expand(app.host);
    await chooseWindow(app.host, 10);
    const signal = app.requests.find(({ url }) => url.endsWith("/events"))?.signal;
    if (reason === "logout") {
      await act(async () => app.host.querySelector<HTMLButtonElement>('[aria-label="Clear token"]')!.click());
    } else {
      app.responses.set("/api/v1/capabilities", new Response("Unauthorized", { status: 401 }));
      await act(async () => { await app.client.refetchQueries({ queryKey: ["capabilities"] }); });
    }
    await settle();
    expect(app.host.querySelector('[role="meter"]')).toBeNull();
    expect(app.host.querySelector('input[name="cpu-window"]')).toBeNull();
    expect(app.client.getQueryCache().getAll()).toHaveLength(0);
    expect(signal?.aborted).toBe(true);
    app.responses.set("/api/v1/capabilities", { docker: true, vm: true });
    app.responses.set("/api/v1/system", cpuSample(10));
    await act(async () => {
      const input = app.host.querySelector<HTMLInputElement>("#app-token")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "new-cpu-token");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => app.host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await settle();
    expect(disclosure(app.host).open).toBe(false);
    expect(app.host.querySelector<HTMLInputElement>('input[name="cpu-window"][value="60"]')?.checked).toBe(true);
    expect(app.host.querySelector('svg[aria-label*="CPU"]')).toBeNull();
  } finally { await app.dispose(); }
});
