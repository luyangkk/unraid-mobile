import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, getSystem, type SystemSnapshot } from "./api";
import { setAppToken, subscribeUnauthorized } from "./auth";
import { subscribeSystem } from "./stream";

const sample = {
  available: true,
  timestamp: "2026-10-24T00:00:00Z",
  hostname: "server",
} as SystemSnapshot;
const stops: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  setAppToken(null);
});

afterEach(async () => {
  for (const stop of stops.splice(0)) stop();
  await vi.advanceTimersByTimeAsync(0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setAppToken(null);
});

// Build a real byte stream with explicit server chunks and cancellation evidence.
function byteStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    cancel,
  });
  const encoder = new TextEncoder();
  return {
    body,
    cancel,
    send: (text: string) => controller.enqueue(encoder.encode(text)),
    sendBytes: (bytes: Uint8Array) => controller.enqueue(bytes),
    close: () => controller.close(),
    error: () => controller.error(new Error("Socket closed")),
    response: () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
  };
}

// Provide visible-page lifecycle controls and isolated snapshot/stream callbacks.
function fixture() {
  const stream = byteStream();
  const order: string[] = [];
  let hidden = false;
  let visibility = () => {};
  const snapshot = vi.fn(async (_signal: AbortSignal) => {
    order.push("snapshot");
    return sample;
  });
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    order.push("stream");
    return stream.response();
  });
  const removeEventListener = vi.fn();
  const options = {
    snapshot,
    fetcher,
    page: {
      get hidden() { return hidden; },
      addEventListener: (_type: "visibilitychange", listener: () => void) => {
        visibility = listener;
      },
      removeEventListener,
    },
    onSnapshot: vi.fn(),
    onConnection: vi.fn(),
    onError: vi.fn(),
  };
  return {
    stream, order, options, removeEventListener,
    hide: () => { hidden = true; visibility(); },
    show: () => { hidden = false; visibility(); },
  };
}

// Track subscription cleanup even when an assertion fails.
function start(options: Parameters<typeof subscribeSystem>[0]) {
  const stop = subscribeSystem(options);
  stops.push(stop);
  return stop;
}

// Flush fetch, decoder and reader continuations without advancing the watchdog.
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

describe("fetch SSE transport", () => {
  it.each([null, "replacement-token", "original-token"])("stops a changed credential session immediately: %j", async (token) => {
    setAppToken("original-token");
    const f = fixture();
    start(f.options);
    await flush();
    f.stream.send('event: system.metrics\ndata: {"available":false,"timestamp":"2026-10-24T00:00:01Z"}\n\n');
    setAppToken(token);
    expect(f.options.fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(f.stream.cancel).toHaveBeenCalledOnce();
    await flush();
    expect(f.options.onSnapshot).toHaveBeenCalledExactlyOnceWith(sample);
    expect(f.stream.body.locked).toBe(false);
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.options.snapshot).toHaveBeenCalledOnce();
    expect(f.options.fetcher).toHaveBeenCalledOnce();
  });

  it("discards pending snapshot results when credentials change before the stream opens", async () => {
    setAppToken("original-token");
    const f = fixture();
    let resolve!: (value: SystemSnapshot) => void;
    f.options.snapshot.mockImplementation(() => new Promise((done) => { resolve = done; }));
    start(f.options);
    setAppToken("replacement-token");
    expect(f.options.snapshot.mock.calls[0][0].aborted).toBe(true);
    resolve(sample);
    await flush();
    expect(f.options.onSnapshot).not.toHaveBeenCalled();
    expect(f.options.fetcher).not.toHaveBeenCalled();
  });

  it("takes a snapshot before opening one authenticated uncached stream", async () => {
    setAppToken("shared-token");
    const f = fixture();
    const stop = start(f.options);
    await flush();
    expect(f.order).toEqual(["snapshot", "stream"]);
    expect(f.options.onSnapshot).toHaveBeenCalledExactlyOnceWith(sample);
    expect(f.options.onConnection).toHaveBeenLastCalledWith("live");
    const [path, init] = f.options.fetcher.mock.calls[0];
    expect(path).toBe("/api/v1/events");
    expect(path).not.toContain("shared-token");
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBe(f.options.snapshot.mock.calls[0][0]);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer shared-token");
    expect(new Headers(init?.headers).get("Accept")).toBe("text/event-stream");
    stop();
    await flush();
    expect(init?.signal?.aborted).toBe(true);
    expect(f.stream.cancel).toHaveBeenCalledOnce();
    expect(f.stream.body.locked).toBe(false);
    expect(f.removeEventListener).toHaveBeenCalledOnce();
  });

  it("uses native fetch when no fetcher is supplied", async () => {
    const f = fixture();
    vi.stubGlobal("fetch", f.options.fetcher);
    const { fetcher: _fetcher, ...options } = f.options;
    start(options);
    await flush();
    expect(f.options.fetcher).toHaveBeenCalledOnce();
  });

  it.each(["\n", "\r\n", "\r"])("parses multiline frames and split UTF-8 with %j lines", async (newline) => {
    const f = fixture();
    start(f.options);
    await flush();
    const frame = [
      ": heartbeat",
      "id: unused",
      "event: system.metrics",
      'data: {"available":true,',
      'data: "timestamp":"next","hostname":"caf\u00e9 \u4e3b\u673a"}',
      "", "",
    ].join(newline);
    const bytes = new TextEncoder().encode(frame);
    for (const byte of bytes) f.stream.sendBytes(Uint8Array.of(byte));
    await flush();
    // A terminal bare CR is a complete delimiter, not a missing LF.
    if (newline === "\r") f.stream.send(": next\r");
    await flush();
    expect(f.options.onSnapshot).toHaveBeenCalledTimes(2);
    expect(f.options.onSnapshot).toHaveBeenLastCalledWith({
      available: true, timestamp: "next", hostname: "caf\u00e9 \u4e3b\u673a",
    });
    expect(f.options.snapshot).toHaveBeenCalledOnce();
  });

  it("waits for a blank line and handles CRLF split between chunks", async () => {
    const f = fixture();
    start(f.options);
    await flush();
    f.stream.send('event: system.metrics\r');
    await flush();
    f.stream.send('\ndata: {"available":false,"timestamp":"next"}\r');
    await flush();
    expect(f.options.onSnapshot).toHaveBeenCalledOnce();
    f.stream.send("\n\r");
    await flush();
    f.stream.send("\n");
    await flush();
    expect(f.options.onSnapshot).toHaveBeenCalledTimes(2);
    f.stream.send('event: system.metrics\ndata: {"available":true,"timestamp":"third"}\n\n');
    await flush();
    expect(f.options.onSnapshot).toHaveBeenLastCalledWith({ available: true, timestamp: "third" });
  });

  it.each([
    ": heartbeat\n\n",
    "event: future.event\ndata: malformed unused data\n\n",
    "event: operation.updated\ndata: malformed unused data\n\n",
    "data: unnamed event\n\n",
  ])("keeps ignored events and comments healthy without reconnecting: %j", async (frame) => {
    const f = fixture();
    start(f.options);
    await flush();
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(15000);
      f.stream.send(frame);
      await flush();
    }
    expect(f.options.snapshot).toHaveBeenCalledOnce();
    expect(f.options.fetcher).toHaveBeenCalledOnce();
    expect(f.options.onSnapshot).toHaveBeenCalledOnce();
    expect(f.options.onConnection).toHaveBeenLastCalledWith("live");
  });

  it("delivers optional operation records without changing the system snapshot", async () => {
    const f = fixture();
    const onOperation = vi.fn();
    start({ ...f.options, onOperation });
    await flush();
    f.stream.send('event: operation.updated\ndata: {"id":"op-1","state":"running","progress":null}\n\n');
    await flush();
    expect(onOperation).toHaveBeenCalledExactlyOnceWith({ id: "op-1", state: "running", progress: null });
    expect(f.options.onSnapshot).toHaveBeenCalledOnce();
  });

  it("ignores event-only frames and resets event names after each blank line", async () => {
    const f = fixture();
    start(f.options);
    await flush();
    f.stream.send('event: system.metrics\n\n: comment\n\ndata: invalid unnamed\n\n');
    f.stream.send('event: system.metrics\ndata: {"available":true,"timestamp":"next"}\n\n');
    await flush();
    expect(f.options.onSnapshot).toHaveBeenCalledTimes(2);
    expect(f.options.onConnection).toHaveBeenLastCalledWith("live");
  });
});

describe("fetch SSE lifecycle", () => {
  it("aborts a stalled snapshot after ten seconds and retries two seconds later", async () => {
    const f = fixture();
    f.options.snapshot.mockImplementation(() => new Promise(() => {}));
    start(f.options);
    const signal = f.options.snapshot.mock.calls[0][0];
    await vi.advanceTimersByTimeAsync(10000);
    expect(signal.aborted).toBe(true);
    expect(f.options.onConnection).toHaveBeenLastCalledWith("offline");
    await vi.advanceTimersByTimeAsync(1999);
    expect(f.options.snapshot).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.options.snapshot).toHaveBeenCalledTimes(2);
    expect(f.options.fetcher).not.toHaveBeenCalled();
  });

  it("gives the stream thirty seconds of idle time before cancelling and retrying", async () => {
    const f = fixture();
    const next = byteStream();
    f.options.fetcher.mockImplementationOnce(async () => f.stream.response())
      .mockImplementationOnce(async () => next.response());
    start(f.options);
    await flush();
    await vi.advanceTimersByTimeAsync(29999);
    expect(f.stream.cancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.stream.cancel).toHaveBeenCalledOnce();
    expect(f.stream.body.locked).toBe(false);
    expect(f.options.onConnection).toHaveBeenLastCalledWith("offline");
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.options.snapshot).toHaveBeenCalledTimes(2);
    expect(f.options.fetcher).toHaveBeenCalledTimes(2);
    expect(f.options.onConnection).toHaveBeenLastCalledWith("live");
  });

  it("aborts a stalled stream fetch after thirty seconds", async () => {
    const f = fixture();
    f.options.fetcher.mockImplementation(() => new Promise(() => {}));
    start(f.options);
    await flush();
    const signal = f.options.fetcher.mock.calls[0][1]?.signal;
    await vi.advanceTimersByTimeAsync(30000);
    expect(signal?.aborted).toBe(true);
    expect(f.options.onConnection).toHaveBeenLastCalledWith("offline");
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.options.snapshot).toHaveBeenCalledTimes(2);
  });

  it.each(["close", "error"] as const)("refetches before reconnecting after reader %s", async (finish) => {
    const f = fixture();
    const next = byteStream();
    f.options.fetcher.mockImplementationOnce(async () => f.stream.response())
      .mockImplementationOnce(async () => next.response());
    start(f.options);
    await flush();
    f.stream[finish]();
    await flush();
    expect(f.options.onConnection).toHaveBeenLastCalledWith("offline");
    expect(f.stream.body.locked).toBe(false);
    await vi.advanceTimersByTimeAsync(1999);
    expect(f.options.snapshot).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.options.snapshot).toHaveBeenCalledTimes(2);
    expect(f.options.fetcher).toHaveBeenCalledTimes(2);
    expect(f.options.onConnection).toHaveBeenLastCalledWith("live");
  });

  it("retries a network fetch failure after a fresh snapshot", async () => {
    const f = fixture();
    f.options.fetcher.mockRejectedValueOnce(new Error("Network unavailable"));
    start(f.options);
    await flush();
    expect(f.options.onError).toHaveBeenLastCalledWith("Network unavailable");
    expect(f.options.onConnection).toHaveBeenLastCalledWith("offline");
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.options.snapshot).toHaveBeenCalledTimes(2);
    expect(f.options.fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    "not-json", "null", '{"available":"true","timestamp":"next"}',
  ])("recovers from invalid system payloads without publishing them: %s", async (payload) => {
    const f = fixture();
    start(f.options);
    await flush();
    f.stream.send(`event: system.metrics\ndata: ${payload}\n\n`);
    await flush();
    expect(f.options.onSnapshot).toHaveBeenCalledOnce();
    expect(f.options.onConnection).toHaveBeenLastCalledWith("offline");
    expect(f.stream.cancel).toHaveBeenCalledOnce();
  });

  it("cancels the reader in the background and takes a fresh snapshot on foreground", async () => {
    const f = fixture();
    const next = byteStream();
    f.options.fetcher.mockImplementationOnce(async () => {
      f.order.push("stream");
      return f.stream.response();
    }).mockImplementationOnce(async () => {
      f.order.push("stream");
      return next.response();
    });
    start(f.options);
    await flush();
    const signal = f.options.fetcher.mock.calls[0][1]?.signal;
    f.hide();
    await flush();
    expect(signal?.aborted).toBe(true);
    expect(f.stream.cancel).toHaveBeenCalledOnce();
    expect(f.stream.body.locked).toBe(false);
    expect(f.options.onConnection).toHaveBeenLastCalledWith("paused");
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.options.snapshot).toHaveBeenCalledOnce();
    f.show();
    await flush();
    expect(f.order).toEqual(["snapshot", "stream", "snapshot", "stream"]);
    expect(next.body.locked).toBe(true);
    expect(f.options.onConnection).toHaveBeenLastCalledWith("live");
  });

  it("does not request anything while initially hidden", async () => {
    const f = fixture();
    f.hide();
    start(f.options);
    await flush();
    expect(f.options.snapshot).not.toHaveBeenCalled();
    expect(f.options.fetcher).not.toHaveBeenCalled();
    expect(f.options.onConnection).toHaveBeenLastCalledWith("paused");
    f.show();
    await flush();
    expect(f.options.fetcher).toHaveBeenCalledOnce();
  });

  it("discards a late snapshot after disposal and unregisters visibility", async () => {
    const f = fixture();
    let resolve!: (value: SystemSnapshot) => void;
    f.options.snapshot.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const stop = start(f.options);
    const signal = f.options.snapshot.mock.calls[0][0];
    stop();
    resolve(sample);
    await flush();
    expect(signal.aborted).toBe(true);
    expect(f.options.onSnapshot).not.toHaveBeenCalled();
    expect(f.options.fetcher).not.toHaveBeenCalled();
    const count = f.options.onConnection.mock.calls.length;
    f.show();
    await flush();
    expect(f.options.onConnection).toHaveBeenCalledTimes(count);
  });

  it("cancels an unconsumed late fetch response after disposal", async () => {
    const f = fixture();
    let resolve!: (value: Response) => void;
    f.options.fetcher.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const stop = start(f.options);
    await flush();
    stop();
    resolve(f.stream.response());
    await flush();
    expect(f.stream.cancel).toHaveBeenCalledOnce();
    expect(f.stream.body.locked).toBe(false);
    expect(f.options.onConnection).not.toHaveBeenCalledWith("live");
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.options.snapshot).toHaveBeenCalledOnce();
  });

  it("does not open a stream when the snapshot callback disposes the subscription", async () => {
    const f = fixture();
    let stop = () => {};
    f.options.onSnapshot.mockImplementation(() => stop());
    stop = start(f.options);
    await flush();
    expect(f.options.fetcher).not.toHaveBeenCalled();
  });

  it("discards the old snapshot when a foreground generation supersedes it", async () => {
    const f = fixture();
    let resolve!: (value: SystemSnapshot) => void;
    f.options.snapshot.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    start(f.options);
    f.hide();
    f.show();
    await flush();
    resolve({ ...sample, timestamp: "old" });
    await flush();
    expect(f.options.onSnapshot).toHaveBeenCalledExactlyOnceWith(sample);
    expect(f.options.fetcher).toHaveBeenCalledOnce();
  });

  it("makes stream 401 terminal even across visibility changes", async () => {
    setAppToken("secret");
    const f = fixture();
    const listener = vi.fn();
    const unsubscribe = subscribeUnauthorized(listener);
    f.options.fetcher.mockResolvedValueOnce(new Response(
      '{"error":{"message":"secret","details":"secret","retryable":true}}', { status: 401 },
    ));
    start(f.options);
    await flush();
    expect(listener).toHaveBeenCalledOnce();
    expect(f.options.onError).toHaveBeenLastCalledWith("Authentication required");
    expect(f.options.onConnection).toHaveBeenLastCalledWith("offline");
    await vi.advanceTimersByTimeAsync(60000);
    f.hide();
    f.show();
    await flush();
    expect(f.options.snapshot).toHaveBeenCalledOnce();
    expect(f.options.fetcher).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("makes snapshot 401 terminal without opening or retrying streams", async () => {
    const f = fixture();
    const fetcher = vi.fn(async () => new Response("secret", { status: 401 }));
    f.options.snapshot.mockImplementation((signal) => getSystem(signal, fetcher));
    start(f.options);
    await flush();
    expect(f.options.onError).toHaveBeenLastCalledWith("Authentication required");
    await vi.advanceTimersByTimeAsync(60000);
    f.hide();
    f.show();
    await flush();
    expect(f.options.snapshot).toHaveBeenCalledOnce();
    expect(f.options.fetcher).not.toHaveBeenCalled();
  });

  it("permits a new subscription after an unauthorized session is replaced", async () => {
    const f = fixture();
    f.options.snapshot.mockRejectedValueOnce(new ApiError("UNAUTHORIZED", "Authentication required", false));
    const stop = start(f.options);
    await flush();
    stop();
    setAppToken("replacement");
    start(f.options);
    await flush();
    expect(f.options.snapshot).toHaveBeenCalledTimes(2);
    expect(f.options.fetcher).toHaveBeenCalledOnce();
    expect(f.options.onConnection).toHaveBeenLastCalledWith("live");
  });
});
