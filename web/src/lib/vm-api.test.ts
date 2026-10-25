import { expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { ApiError, getVMs } from "./api";

it("reads a fresh VM snapshot and forwards cancellation", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ available: false, reason: "No libvirt socket" }), { status: 200 }));
  const signal = new AbortController().signal;
  await expect(getVMs(signal, fetcher)).resolves.toMatchObject({ available: false });
  expect(fetcher).toHaveBeenCalledWith("/api/v1/vms", { headers: new Headers({ Accept: "application/json" }), cache: "no-store", signal });
});

it("preserves the API message on request failure", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "VM_DENIED", message: "VM proxy denied the request", retryable: false } }), { status: 403 }));
  await expect(getVMs(undefined, fetcher)).rejects.toMatchObject({ name: "ApiError", code: "VM_DENIED", message: "VM proxy denied the request", retryable: false });
});

it("aborts an in-flight read when the last VM observer unmounts", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let requestSignal: AbortSignal | undefined;
  const fetcher = (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    requestSignal = init?.signal ?? undefined;
    requestSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  });
  const observer = new QueryObserver(client, { queryKey: ["vms"], queryFn: ({ signal }) => getVMs(signal, fetcher) });
  const unsubscribe = observer.subscribe(() => {});
  await vi.waitFor(() => expect(requestSignal).toBeDefined());
  unsubscribe();
  expect(requestSignal?.aborted).toBe(true);
  client.clear();
});

it("retains a cached VM snapshot when a refresh fails", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const sample = { available: true, domains: [{ name: "Windows" }] };
  client.setQueryData(["vms"], sample);
  await expect(client.fetchQuery({ queryKey: ["vms"], queryFn: () => getVMs(undefined, async () => new Response("", { status: 502 })) })).rejects.toBeInstanceOf(ApiError);
  expect(client.getQueryData(["vms"])).toEqual(sample);
  client.clear();
});
