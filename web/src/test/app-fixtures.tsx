import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import App from "../App";
import { clearAppToken } from "../lib/auth";
import type { DockerSnapshot, StorageSnapshot, SystemSnapshot, VMSnapshot } from "../lib/api";

export const systemSample: SystemSnapshot = {
  timestamp: "2026-10-24T00:00:00Z", available: true, hostname: "Tower",
  uptimeSeconds: 120, cpuUsage: 25, cpuTemperature: 42,
  memoryUsedBytes: 1073741824, memoryTotalBytes: 2147483648,
  networkInterface: "br0", networkRXRate: 1048576, networkTXRate: null, diagnostics: {},
};
export const dockerSample: DockerSnapshot = {
  timestamp: systemSample.timestamp, available: true,
  containers: [
    { id: "plex", name: "Plex", state: "running", cpuUsage: 3.5, memoryUsedBytes: 1024,
      memoryLimitBytes: 2048, uptimeSeconds: 120, networkRXRate: 2048, networkTXRate: 1024, diagnostics: [] },
    { id: "backup", name: "Backup", state: "exited", cpuUsage: null, memoryUsedBytes: null,
      memoryLimitBytes: null, uptimeSeconds: null, networkRXRate: null, networkTXRate: null, diagnostics: [] },
    { id: "db", name: "Database", state: "paused", cpuUsage: null, memoryUsedBytes: null,
      memoryLimitBytes: null, uptimeSeconds: null, networkRXRate: null, networkTXRate: null, diagnostics: [] },
  ],
  summary: { running: 1, stopped: 1, other: 1 }, diagnostics: [],
};
export const vmSample: VMSnapshot = {
  timestamp: systemSample.timestamp, available: true,
  domains: [
    { id: "linux", name: "Linux", state: "running", vcpus: 2, memoryBytes: 1024, uptimeSeconds: null, diagnostics: [] },
    { id: "windows", name: "Windows", state: "shutoff", vcpus: 4, memoryBytes: 2048, uptimeSeconds: null, diagnostics: [] },
  ],
  summary: { running: 1, stopped: 1, other: 0 }, diagnostics: [],
};
export const storageSample: StorageSnapshot = {
  timestamp: systemSample.timestamp, available: true, source: "fixture",
  array: { state: "Started", diskCount: 1, capacity: { totalBytes: 2048, usedBytes: 1024, freeBytes: 1024 } },
  parity: { state: "Idle", action: "", progress: null },
  pools: [{ name: "cache", state: "Mounted", filesystem: "btrfs", diskCount: 1,
    capacity: { totalBytes: 2048, usedBytes: 1024, freeBytes: 1024 } }],
  disks: [{ name: "disk1", device: "sdb", role: "data", status: "OK", powerState: "active",
    filesystem: "xfs", filesystemStatus: "Mounted", sizeBytes: 2048, temperature: 35,
    capacity: { totalBytes: 2048, usedBytes: 1024, freeBytes: 1024 },
    readBytesPerSecond: 1024, writeBytesPerSecond: 2048 }],
  diagnostics: ["Storage fixture diagnostic"],
};

// settle flushes router lazy loading and Query observer notifications.
export async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
}

// mountApp exercises the real router, authentication and fetch stream boundaries.
export async function mountApp(path = "/", cached = true) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("matchMedia", () => ({
    matches: true, addEventListener() {}, removeEventListener() {},
  }));
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  window.history.replaceState(null, "", path);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  if (cached) {
    client.setQueryData(["system"], systemSample);
    client.setQueryData(["docker"], dockerSample);
    client.setQueryData(["vms"], vmSample);
    client.setQueryData(["storage"], storageSample);
  }
  const requests: { url: string; signal?: AbortSignal | null }[] = [];
  const responses = new Map<string, unknown>([
    ["/api/v1/capabilities", { docker: true, vm: true, dockerActions: { start: false, stop: false, restart: false },
      vmActions: { start: false, stop: false, forceStop: false } }],
    ["/api/v1/system", systemSample], ["/api/v1/docker", dockerSample],
    ["/api/v1/vms", vmSample], ["/api/v1/storage", storageSample],
  ]);
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, signal: init?.signal });
    if (url.endsWith("/events")) return new Response(new ReadableStream<Uint8Array>({
      start(controller) { stream = controller; },
      cancel() { stream = undefined; },
    }), { headers: { "Content-Type": "text/event-stream" } });
    const value = responses.get(url);
    if (value instanceof Response) return value.clone();
    if (value instanceof Promise) return value;
    if (value instanceof Error) throw value;
    return new Response(JSON.stringify(value));
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(
    <QueryClientProvider client={client}><App /></QueryClientProvider>,
  ));
  await settle();
  return {
    host, client, requests, responses,
    // navigate uses the visible navigation link rather than router internals.
    async navigate(label: string) {
      const link = [...host.querySelectorAll<HTMLAnchorElement>("nav a")].find((node) => node.textContent === label);
      if (!link) throw new Error(`Missing navigation ${label}`);
      await act(async () => link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
      await settle();
    },
    // emit simulates a server metrics frame over the real stream parser.
    async emit(snapshot: SystemSnapshot) {
      await act(async () => stream?.enqueue(new TextEncoder().encode(
        `event: system.metrics\ndata: ${JSON.stringify(snapshot)}\n\n`,
      )));
      await settle();
    },
    // dispose removes transports and credentials between browser tests.
    async dispose() {
      await act(async () => root.unmount());
      client.clear();
      host.remove();
      clearAppToken();
      sessionStorage.clear();
      localStorage.clear();
      window.history.replaceState(null, "", "/");
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    },
  };
}
