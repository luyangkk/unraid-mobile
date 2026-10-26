import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError, authenticatedFetch, getCapabilities, getSystem, getStorage,
  getDocker, getVMs,
} from "./api";
import { setAppToken, subscribeUnauthorized } from "./auth";
import { systemSample } from "../test/app-fixtures";

afterEach(() => setAppToken(null));

describe("getCapabilities", () => {
  it("requests the versioned endpoint and returns its payload", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ docker: true, vm: false }), {
        status: 200,
      }),
    );

    await expect(getCapabilities(fetcher)).resolves.toEqual({
      docker: true,
      vm: false,
    });
    expect(fetcher).toHaveBeenCalledWith("/api/v1/capabilities", {
      headers: new Headers({ Accept: "application/json" }),
      cache: "no-store",
      signal: undefined,
    });
  });

  it("forwards capability validation cancellation without caching", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
    const signal = new AbortController().signal;
    await getCapabilities(fetcher, signal);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ signal, cache: "no-store" });
  });

  it("turns an API error into a typed client error", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "CAPABILITY_UNAVAILABLE",
            message: "Unavailable",
            retryable: false,
          },
        }),
        {
          status: 409,
        },
      ),
    );

    await expect(getCapabilities(fetcher)).rejects.toMatchObject({
      code: "CAPABILITY_UNAVAILABLE",
      message: "Unavailable",
      retryable: false,
    });
  });
});

describe("getSystem", () => {
  it.each([true, false])("preserves complete network fields and old-server compatibility: array=%s", async (withInterfaces) => {
    const payload = { ...systemSample, networkInterfaces: withInterfaces ? systemSample.networkInterfaces : undefined };
    const result = await getSystem(undefined, async () => new Response(JSON.stringify(payload)));
    expect(result.networkInterface).toBe("br0");
    expect(result.networkRXRate).toBe(1048576);
    expect(result.networkTXRate).toBeNull();
    expect(result.networkInterfaces).toEqual(withInterfaces ? [
      { name: "br0", available: true, rxBytesPerSecond: 1048576, txBytesPerSecond: null },
      { name: "eth0", available: true, rxBytesPerSecond: 2097152, txBytesPerSecond: 524288 },
    ] : undefined);
  });

  it("loads a fresh system snapshot and passes cancellation", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          available: false,
          reason: "Mount /proc",
          timestamp: "2026-10-24T00:00:00Z",
        }),
        { status: 200 },
      ),
    );
    const signal = new AbortController().signal;
    await expect(getSystem(signal, fetcher)).resolves.toMatchObject({
      available: false,
      reason: "Mount /proc",
    });
    expect(fetcher).toHaveBeenCalledWith("/api/v1/system", {
      headers: new Headers({ Accept: "application/json" }),
      cache: "no-store",
      signal,
    });
  });
});

describe("getStorage", () => {
  it("fetches current storage data without offline caching", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ available: false, reason: "Metadata not mounted" }),
          { status: 200 },
        ),
      );
    const signal = new AbortController().signal;
    await expect(getStorage(signal, fetcher)).resolves.toMatchObject({
      available: false,
    });
    expect(fetcher).toHaveBeenCalledWith("/api/v1/storage", {
      headers: new Headers({ Accept: "application/json" }),
      cache: "no-store",
      signal,
    });
  });
});

describe("authenticatedFetch", () => {
  it.each([
    { "X-Custom": "value" },
    [["X-Custom", "value"]] as [string, string][],
    new Headers({ "X-Custom": "value" }),
  ])("adds shared authorization while preserving caller headers: %j", async (headers) => {
    setAppToken("exact-token");
    const signal = new AbortController().signal;
    const init = { headers, signal, cache: "no-store" as const, method: "GET" };
    const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
    await authenticatedFetch("/api/v1/system", init, fetcher);
    const [path, sent] = fetcher.mock.calls[0];
    expect(path).toBe("/api/v1/system");
    expect(path).not.toContain("exact-token");
    expect(sent).toMatchObject({ signal, cache: "no-store", method: "GET" });
    expect(new Headers(sent.headers).get("Authorization")).toBe("Bearer exact-token");
    expect(new Headers(sent.headers).get("Accept")).toBe("application/json");
    expect(new Headers(sent.headers).get("X-Custom")).toBe("value");
    expect(new Headers(headers).has("Authorization")).toBe(false);
  });

  it("preserves SSE Accept and overrides caller authorization with the shared token", async () => {
    setAppToken("shared");
    const fetcher = vi.fn().mockResolvedValue(new Response());
    await authenticatedFetch("/api/v1/events", {
      headers: { Accept: "text/event-stream", Authorization: "Bearer caller" },
    }, fetcher);
    const headers = new Headers(fetcher.mock.calls[0][1].headers);
    expect(headers.get("Accept")).toBe("text/event-stream");
    expect(headers.get("Authorization")).toBe("Bearer shared");
  });

  it("omits authorization in LAN mode", async () => {
    setAppToken(null);
    const fetcher = vi.fn().mockResolvedValue(new Response());
    await authenticatedFetch("/api/v1/system", {}, fetcher);
    expect(new Headers(fetcher.mock.calls[0][1].headers).has("Authorization")).toBe(false);
  });

  it.each(["json", "malformed", "unreadable"])("sanitizes every 401 response: %s", async (kind) => {
    setAppToken("secret");
    const listener = vi.fn();
    const unsubscribe = subscribeUnauthorized(listener);
    const response = new Response(kind === "json"
      ? JSON.stringify({ error: { code: "SECRET", message: "secret", details: "secret", retryable: true } })
      : "secret malformed body", { status: 401 });
    const read = vi.spyOn(response, "json").mockRejectedValue(new Error("secret"));
    const fetcher = vi.fn().mockResolvedValue(response);
    await expect(authenticatedFetch("/api/v1/system", {}, fetcher)).rejects.toMatchObject({
      name: "ApiError", code: "UNAUTHORIZED", message: "Authentication required",
      retryable: false, details: undefined,
    });
    expect(read).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("ignores late old-session 401s even if the aborted fetch still resolves", async () => {
    setAppToken("old");
    const listener = vi.fn();
    const unsubscribe = subscribeUnauthorized(listener);
    let resolve!: (response: Response) => void;
    const controller = new AbortController();
    const pending = authenticatedFetch("/api/v1/system", { signal: controller.signal },
      () => new Promise((done) => { resolve = done; }));
    controller.abort();
    setAppToken("new");
    resolve(new Response("old secret", { status: 401 }));
    await expect(pending).rejects.toBeInstanceOf(ApiError);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("reports a current revision 401 even if the request started in LAN mode", async () => {
    setAppToken(null);
    const listener = vi.fn();
    const unsubscribe = subscribeUnauthorized(listener);
    await expect(authenticatedFetch("/api/v1/capabilities", {},
      async () => new Response(null, { status: 401 }))).rejects.toBeInstanceOf(ApiError);
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it.each([
    ["capabilities", (fetcher: typeof fetch) => getCapabilities(fetcher)],
    ["system", (fetcher: typeof fetch) => getSystem(undefined, fetcher)],
    ["storage", (fetcher: typeof fetch) => getStorage(undefined, fetcher)],
    ["docker", (fetcher: typeof fetch) => getDocker(undefined, fetcher)],
    ["vms", (fetcher: typeof fetch) => getVMs(undefined, fetcher)],
  ] as const)("centralizes headers and safe 401s for %s", async (_name, read) => {
    setAppToken("shared");
    const fetcher = vi.fn().mockResolvedValue(new Response("malicious secret", { status: 401 }));
    await expect(read(fetcher)).rejects.toMatchObject({
      code: "UNAUTHORIZED", message: "Authentication required", retryable: false,
    });
    expect(new Headers(fetcher.mock.calls[0][1].headers).get("Authorization")).toBe("Bearer shared");
  });
});
