// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDocker } from "../../lib/api";
import { getAuthRevision, reportUnauthorized } from "../../lib/auth";
import { subscribeSystem } from "../../lib/stream";
import { SessionGate } from "./SessionGate";

const tokenKey = "unraid-mobile.app-token";
let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
let requests: { url: string; init?: RequestInit }[];
let controllers: ReadableStreamDefaultController<Uint8Array>[];
let cancelStream: ReturnType<typeof vi.fn>;
let respond: (url: string, init?: RequestInit) => Promise<Response>;

// json produces real fetch responses for the client boundary.
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}

// unauthorized models a server requiring credentials without echoing secrets.
function unauthorized() {
  return json({ error: { code: "UNAUTHORIZED", message: "Authentication required", retryable: false } }, 401);
}

// BusinessProbe exercises actual query and stream lifecycles behind the gate.
function BusinessProbe({ logout }: { logout: () => void }) {
  useQuery({ queryKey: ["docker"], queryFn: ({ signal }) => getDocker(signal), retry: false });
  useEffect(() => subscribeSystem({
    snapshot: async () => ({
      available: false, timestamp: "2026-10-24T00:00:00Z",
    }) as never,
    page: document,
    onSnapshot: (sample) => client.setQueryData(["system"], sample),
    onConnection: () => {},
  }), []);
  return <div><p>Protected dashboard</p><button onClick={logout}>Log out</button></div>;
}

// mount runs the real gate and protected component in a browser DOM.
async function mount() {
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <SessionGate>{({ logout }) => <BusinessProbe logout={logout} />}</SessionGate>
    </QueryClientProvider>,
  ));
}

// flush settles fetch and React updates without advancing polling timers.
async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}

// submit exercises the password field and form events with an exact credential.
async function submit(token: string) {
  const input = host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, token);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await flush();
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  requests = [];
  controllers = [];
  cancelStream = vi.fn();
  respond = async (url) => {
    if (url.endsWith("/events")) {
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) { controllers.push(controller); },
        cancel: cancelStream,
      }), { headers: { "Content-Type": "text/event-stream" } });
    }
    return json({ docker: false, vm: false });
  };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    return respond(url, init);
  }));
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  vi.unstubAllGlobals();
});

describe("authentication session gate", () => {
  it("validates capabilities first in LAN mode before any protected data or stream", async () => {
    let finish: (value: Response) => void = () => {};
    respond = (url) => url.endsWith("/capabilities")
      ? new Promise((resolve) => { finish = resolve; })
      : Promise.resolve(json({ available: false }));
    await mount();
    expect(requests.map((request) => request.url)).toEqual(["/api/v1/capabilities"]);
    expect(host.textContent).not.toContain("Protected dashboard");
    await act(async () => finish(json({ docker: false, vm: false })));
    await flush();
    expect(host.textContent).toContain("Protected dashboard");
    expect(host.querySelector("input")).toBeNull();
    expect(sessionStorage.getItem(tokenKey)).toBeNull();
  });

  it("shows an accessible password form and sends no business requests for an invalid token", async () => {
    respond = async () => unauthorized();
    await mount();
    expect(host.querySelector('input[type="password"]')).not.toBeNull();
    expect(host.querySelector("label")?.textContent).toContain("APP_TOKEN");
    await submit("wrong-token");
    expect(sessionStorage.getItem(tokenKey)).toBeNull();
    expect(requests.every(({ url }) => url === "/api/v1/capabilities")).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Authentication required");
    expect(host.innerHTML).not.toContain("wrong-token");
  });

  it("persists a validated exact token only in sessionStorage and shares it with REST and SSE", async () => {
    const token = "valid-session-token";
    respond = async (url, init) => {
      if (new Headers(init?.headers).get("Authorization") !== `Bearer ${token}`) return unauthorized();
      if (url.endsWith("/events")) return new Response(new ReadableStream({
        start(controller) { controllers.push(controller); }, cancel: cancelStream,
      }), { headers: { "Content-Type": "text/event-stream" } });
      return json({ docker: false, vm: false });
    };
    await mount();
    await submit(token);
    expect(host.textContent).toContain("Protected dashboard");
    expect(sessionStorage.getItem(tokenKey)).toBe(token);
    expect(localStorage.length).toBe(0);
    expect(requests.some(({ url }) => url.endsWith("/events"))).toBe(true);
    for (const request of requests.slice(1)) {
      expect(new Headers(request.init?.headers).get("Authorization")).toBe(`Bearer ${token}`);
      expect(request.url).not.toContain(token);
    }
    expect(JSON.stringify(client.getQueryCache().getAll().map((query) => query.queryKey))).not.toContain(token);
  });

  it("restores a validated token after remount without showing a password form", async () => {
    sessionStorage.setItem(tokenKey, "restored-session-token");
    await mount();
    await flush();
    expect(new Headers(requests[0].init?.headers).get("Authorization")).toBe("Bearer restored-session-token");
    expect(host.textContent).toContain("Protected dashboard");
    expect(host.querySelector("input")).toBeNull();
  });

  it("disables the field and submit button while verifying without storing a candidate", async () => {
    let finish: (value: Response) => void = () => {};
    respond = async () => unauthorized();
    await mount();
    respond = () => new Promise((resolve) => { finish = resolve; });
    await submit("pending-token");
    expect(host.querySelector("input")!.disabled).toBe(true);
    expect(host.querySelector('button[type="submit"]')!.hasAttribute("disabled")).toBe(true);
    expect(sessionStorage.getItem(tokenKey)).toBeNull();
    await act(async () => finish(unauthorized()));
    expect(host.querySelector("input")!.disabled).toBe(false);
  });

  it("clears credentials, protected cache, pending requests and SSE when logging out", async () => {
    sessionStorage.setItem(tokenKey, "logout-session-token");
    await mount();
    await flush();
    let pendingSignal: AbortSignal | undefined;
    respond = async (url, init) => {
      if (url.endsWith("/docker")) {
        pendingSignal = init?.signal ?? undefined;
        return new Promise(() => {});
      }
      return json({});
    };
    void client.refetchQueries({ queryKey: ["docker"] });
    await flush();
    expect(pendingSignal?.aborted).toBe(false);
    await act(async () => host.querySelector("button")!.click());
    await flush();
    expect(sessionStorage.getItem(tokenKey)).toBeNull();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(pendingSignal?.aborted).toBe(true);
    expect(cancelStream).toHaveBeenCalledOnce();
    expect(host.querySelector('input[type="password"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Protected dashboard");
  });

  it("ends a ready session on any REST 401 without retry or stale cache", async () => {
    sessionStorage.setItem(tokenKey, "expired-session-token");
    await mount();
    await flush();
    respond = async () => unauthorized();
    await act(async () => { await client.refetchQueries({ queryKey: ["docker"] }); });
    await flush();
    expect(host.querySelector("input")).not.toBeNull();
    expect(sessionStorage.getItem(tokenKey)).toBeNull();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(cancelStream).toHaveBeenCalledOnce();
  });

  it("returns to the form and stops reconnecting after SSE 401", async () => {
    sessionStorage.setItem(tokenKey, "sse-expired-token");
    respond = async (url) => url.endsWith("/events") ? unauthorized() : json({ docker: false, vm: false });
    await mount();
    await flush();
    expect(host.querySelector("input")).not.toBeNull();
    expect(requests.filter(({ url }) => url.endsWith("/events"))).toHaveLength(1);
    expect(sessionStorage.getItem(tokenKey)).toBeNull();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it("invalidates queued SSE frames synchronously when an API rejects the session", async () => {
    sessionStorage.setItem(tokenKey, "queued-session-token");
    await mount();
    await flush();
    let canceledImmediately = false;
    await act(async () => {
      controllers[0].enqueue(new TextEncoder().encode(
        'event: system.metrics\ndata: {"available":false,"timestamp":"2026-10-24T00:00:01Z"}\n\n',
      ));
      reportUnauthorized(getAuthRevision());
      canceledImmediately = cancelStream.mock.calls.length === 1;
      await Promise.resolve();
    });
    await flush();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(canceledImmediately).toBe(true);
    expect(host.querySelector("input")).not.toBeNull();
  });

  it("preserves a saved credential across a network failure and retries with it", async () => {
    sessionStorage.setItem(tokenKey, "network-session-token");
    respond = async () => { throw new TypeError("Network unavailable"); };
    await mount();
    expect(sessionStorage.getItem(tokenKey)).toBe("network-session-token");
    expect(host.querySelector("button")?.textContent).toBe("Retry connection");
    respond = async () => json({ docker: false, vm: false });
    await act(async () => host.querySelector("button")!.click());
    await flush();
    expect(new Headers(requests[1].init?.headers).get("Authorization")).toBe("Bearer network-session-token");
    expect(host.textContent).toContain("Protected dashboard");
    expect(sessionStorage.getItem(tokenKey)).toBe("network-session-token");
  });

  it("recovers an offline cold boot on online without clearing a token or admitting business requests early", async () => {
    sessionStorage.setItem(tokenKey, "offline-session-token");
    respond = async () => { throw new TypeError("Network unavailable"); };
    await mount();
    expect(host.querySelector('input[type="password"]')).toBeNull();
    expect(host.textContent).toContain("Couldn't verify access");
    expect(sessionStorage.getItem(tokenKey)).toBe("offline-session-token");
    expect(requests.map(({ url }) => url)).toEqual(["/api/v1/capabilities"]);

    let finish: (value: Response) => void = () => {};
    respond = (url) => url.endsWith("/capabilities")
      ? new Promise((resolve) => { finish = resolve; })
      : Promise.resolve(json({ available: false }));
    await act(async () => window.dispatchEvent(new Event("online")));
    await flush();
    expect(requests.map(({ url }) => url)).toEqual(["/api/v1/capabilities", "/api/v1/capabilities"]);
    expect(host.textContent).not.toContain("Protected dashboard");
    await act(async () => finish(json({ docker: false, vm: false })));
    await flush();
    expect(host.textContent).toContain("Protected dashboard");
    expect(new Headers(requests[1].init?.headers).get("Authorization")).toBe("Bearer offline-session-token");
    expect(sessionStorage.getItem(tokenKey)).toBe("offline-session-token");
  });
});
