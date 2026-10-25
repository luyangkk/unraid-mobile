// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import App from "./App";

it("starts only capabilities until access is verified, then loads all panels with the same credential", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("matchMedia", () => ({
    matches: true, addEventListener() {}, removeEventListener() {},
  }));
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const token = "dashboard-session-fixture";
  sessionStorage.setItem("unraid-mobile.app-token", token);
  const requests: { url: string; init?: RequestInit }[] = [];
  let finish: (response: Response) => void = () => {};
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === "/api/v1/capabilities") return new Promise<Response>((resolve) => { finish = resolve; });
    if (url.endsWith("/events")) return new Response(new ReadableStream(), { headers: { "Content-Type": "text/event-stream" } });
    return new Response(JSON.stringify({
      available: false, timestamp: "2026-10-24T00:00:00Z", reason: "Fixture unavailable",
      containers: [], domains: [], diagnostics: [],
      summary: { running: 0, stopped: 0, other: 0 },
      source: "", array: { state: "unknown", diskCount: 0, capacity: null },
      parity: { state: "unknown", action: "", progress: null }, pools: [], disks: [],
      hostname: "", uptimeSeconds: null, cpuUsage: null, cpuTemperature: null,
      memoryUsedBytes: 0, memoryTotalBytes: 0, networkInterface: "",
      networkRXRate: null, networkTXRate: null,
    }));
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(
      <QueryClientProvider client={client}><App /></QueryClientProvider>,
    ));
    expect(requests.map(({ url }) => url)).toEqual(["/api/v1/capabilities"]);
    expect(host.querySelector("nav")).toBeNull();
    expect(host.textContent).not.toContain("System");
    await act(async () => finish(new Response(JSON.stringify({ docker: false, vm: false }))));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(requests.map(({ url }) => url).sort()).toEqual([
      "/api/v1/capabilities", "/api/v1/docker", "/api/v1/events",
      "/api/v1/storage", "/api/v1/system", "/api/v1/vms",
    ]);
    for (const { url, init } of requests) {
      expect(url).not.toContain(token);
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${token}`);
    }
    expect(host.querySelector('[aria-label="Clear token"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});
