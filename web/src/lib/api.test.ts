import { describe, expect, it, vi } from "vitest";

import { ApiError, getCapabilities } from "./api";

describe("getCapabilities", () => {
  it("requests the versioned endpoint and returns its payload", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ docker: true, vm: false }), { status: 200 }),
    );

    await expect(getCapabilities(fetcher)).resolves.toEqual({ docker: true, vm: false });
    expect(fetcher).toHaveBeenCalledWith("/api/v1/capabilities", { headers: { Accept: "application/json" } });
  });

  it("turns an API error into a typed client error", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "CAPABILITY_UNAVAILABLE", message: "Unavailable", retryable: false } }), {
        status: 409,
      }),
    );

    await expect(getCapabilities(fetcher)).rejects.toMatchObject({
      code: "CAPABILITY_UNAVAILABLE",
      message: "Unavailable",
      retryable: false,
    });
  });
});
