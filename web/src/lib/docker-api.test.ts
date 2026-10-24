import { expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { getDocker } from "./api";

it("loads a fresh Docker snapshot and forwards cancellation", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ available: false, reason: "No Docker socket" }), { status: 200 }),
  );
  const signal = new AbortController().signal;
  await expect(getDocker(signal, fetcher)).resolves.toMatchObject({ available: false });
  expect(fetcher).toHaveBeenCalledWith("/api/v1/docker", {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });
});

it("aborts an in-flight Docker read when its last query observer unmounts", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let requestSignal: AbortSignal | undefined;
  const fetcher = (_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      requestSignal = init?.signal ?? undefined;
      requestSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });
  const observer = new QueryObserver(client, {
    queryKey: ["docker"],
    queryFn: ({ signal }) => getDocker(signal, fetcher),
  });
  const unsubscribe = observer.subscribe(() => {});
  await vi.waitFor(() => expect(requestSignal).toBeDefined());
  expect(requestSignal?.aborted).toBe(false);
  unsubscribe();
  expect(requestSignal?.aborted).toBe(true);
  client.clear();
});
