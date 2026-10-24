import { describe, expect, it, vi } from "vitest";
import { subscribeSystem } from "./stream";

describe("system stream lifecycle", () => {
  it("times out stalled snapshot requests and retries", async () => {
    vi.useFakeTimers();
    try {
      const snapshot = vi.fn().mockImplementation(() => new Promise(() => {}));
      const onConnection = vi.fn();
      const stop = subscribeSystem({
        snapshot,
        source: vi.fn(),
        page: {
          hidden: false,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
        onSnapshot: vi.fn(),
        onConnection,
      });
      await vi.advanceTimersByTimeAsync(10000);
      expect(onConnection).toHaveBeenLastCalledWith("offline");
      await vi.advanceTimersByTimeAsync(2000);
      expect(snapshot).toHaveBeenCalledTimes(2);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
  it("loads snapshot before connecting and pauses on hidden pages", async () => {
    const order: string[] = [];
    let hidden = false;
    let visibility = () => {};
    const source = { close: vi.fn(), addEventListener: vi.fn() };
    const stop = subscribeSystem({
      snapshot: async () => {
        order.push("snapshot");
        return { available: true } as never;
      },
      source: () => {
        order.push("stream");
        return source as never;
      },
      page: {
        get hidden() {
          return hidden;
        },
        addEventListener: (_type: string, fn: () => void) => {
          visibility = fn;
        },
        removeEventListener: vi.fn(),
      },
      onSnapshot: vi.fn(),
      onConnection: vi.fn(),
    });
    await vi.waitFor(() => expect(order).toEqual(["snapshot", "stream"]));
    hidden = true;
    visibility();
    expect(source.close).toHaveBeenCalledOnce();
    hidden = false;
    visibility();
    await vi.waitFor(() =>
      expect(order).toEqual(["snapshot", "stream", "snapshot", "stream"]),
    );
    stop();
    expect(source.close).toHaveBeenCalledTimes(2);
  });
  it("ignores late snapshot responses after disposal", async () => {
    let resolve: (data: never) => void = () => {};
    const source = vi.fn(),
      onSnapshot = vi.fn();
    const stop = subscribeSystem({
      snapshot: () =>
        new Promise((r) => {
          resolve = r;
        }),
      source,
      page: {
        hidden: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      onSnapshot,
      onConnection: vi.fn(),
    });
    stop();
    resolve({ available: true } as never);
    await Promise.resolve();
    await Promise.resolve();
    expect(source).not.toHaveBeenCalled();
    expect(onSnapshot).not.toHaveBeenCalled();
  });
  it("refetches snapshot before reconnecting after stream failure", async () => {
    vi.useFakeTimers();
    try {
      const listeners: Record<string, (event: MessageEvent) => void> = {};
      const snapshot = vi.fn().mockResolvedValue({ available: true });
      const source = () =>
        ({
          close: vi.fn(),
          addEventListener: (
            name: string,
            fn: (event: MessageEvent) => void,
          ) => {
            listeners[name] = fn;
          },
        }) as never;
      const stop = subscribeSystem({
        snapshot,
        source,
        page: {
          hidden: false,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
        onSnapshot: vi.fn(),
        onConnection: vi.fn(),
      });
      await vi.advanceTimersByTimeAsync(0);
      listeners.error(new MessageEvent("error"));
      await vi.advanceTimersByTimeAsync(2000);
      expect(snapshot).toHaveBeenCalledTimes(2);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
