import { describe, expect, it, vi } from "vitest";

import { ApiError, getCapabilities, getSystem, getStorage } from "./api";

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
      headers: { Accept: "application/json" },
    });
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
      headers: { Accept: "application/json" },
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
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal,
    });
  });
});
