import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { shouldRetryRequest } from "./query";

describe("API query retry policy", () => {
  it("does not retry authentication or other nonretryable errors", async () => {
    for (const code of ["UNAUTHORIZED", "CAPABILITY_UNAVAILABLE"]) {
      let attempts = 0;
      const client = new QueryClient({
        defaultOptions: { queries: { retry: shouldRetryRequest, retryDelay: 0 } },
      });
      await expect(client.fetchQuery({
        queryKey: ["protected"],
        queryFn: async () => {
          attempts++;
          throw new ApiError(code, "Request rejected", false);
        },
      })).rejects.toMatchObject({ code });
      expect(attempts).toBe(1);
      client.clear();
    }
  });

  it("retries a retryable network failure once", async () => {
    let attempts = 0;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: shouldRetryRequest, retryDelay: 0 } },
    });
    await expect(client.fetchQuery({
      queryKey: ["protected"],
      queryFn: async () => {
        attempts++;
        throw new TypeError("Network unavailable");
      },
    })).rejects.toThrow("Network unavailable");
    expect(attempts).toBe(2);
    client.clear();
  });
});
