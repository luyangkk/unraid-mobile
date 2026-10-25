import { ApiError, authenticatedFetch, type Fetcher, type SystemSnapshot } from "./api";
import { getAuthRevision, subscribeAuthChange } from "./auth";
import type { Connection } from "./system";

type Page = {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
};
type Options = {
  snapshot: (signal: AbortSignal) => Promise<SystemSnapshot>;
  fetcher?: Fetcher;
  page: Page;
  onSnapshot: (snapshot: SystemSnapshot) => void;
  onOperation?: (operation: Record<string, unknown>) => void;
  onConnection: (state: Connection) => void;
  onError?: (error: string | null) => void;
};

// Parse incremental SSE lines, including CRLF split across decoded chunks.
function frameParser(onFrame: (event: string, data: string) => void) {
  let line = "", event = "", skipLF = false;
  let data: string[] = [];

  // Dispatch only data-bearing frames and reset all per-event fields.
  const consumeLine = () => {
    if (line === "") {
      const name = event, payload = data;
      event = "";
      data = [];
      if (payload.length) onFrame(name, payload.join("\n"));
    } else if (!line.startsWith(":")) {
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      if (field === "data") data.push(value);
    }
    line = "";
  };

  // Treat bare CR as a delimiter while suppressing its optional following LF.
  return (chunk: string) => {
    for (const character of chunk) {
      if (skipLF) {
        skipLF = false;
        if (character === "\n") continue;
      }
      if (character === "\r" || character === "\n") {
        consumeLine();
        skipLF = character === "\r";
      } else line += character;
    }
  };
}

// Reconnect explicitly so every new stream is preceded by a fresh REST snapshot.
export function subscribeSystem(options: Options): () => void {
  const authRevision = getAuthRevision();
  let disposed = false, unauthorized = false, generation = 0;
  let controller: AbortController | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined,
    watchdog: ReturnType<typeof setTimeout> | undefined;

  // Reject continuations from disposed, paused or superseded connections.
  const active = (current: number) =>
    !disposed && !unauthorized && !options.page.hidden && generation === current &&
    getAuthRevision() === authRevision;

  // Abort both transport phases and release any pending reader before reuse.
  const clear = () => {
    generation++;
    controller?.abort();
    controller = undefined;
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
      reader = undefined;
    }
    clearTimeout(retry);
    clearTimeout(watchdog);
  };

  // Retry network failures only while this subscription remains visible and valid.
  const recover = () => {
    clear();
    if (disposed || unauthorized || options.page.hidden) return;
    options.onConnection("offline");
    if (disposed || unauthorized || options.page.hidden) return;
    retry = setTimeout(() => void connect(), 2000);
  };

  // Use a short snapshot deadline and a stream deadline longer than server heartbeats.
  const arm = (current: number, milliseconds: number) => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      if (active(current)) recover();
    }, milliseconds);
  };

  // Fetch the snapshot first, then consume exactly one authenticated stream.
  const connect = async () => {
    clear();
    if (disposed || unauthorized) return;
    if (options.page.hidden) {
      if (!disposed) options.onConnection("paused");
      return;
    }
    const current = generation;
    controller = new AbortController();
    const signal = controller.signal;
    options.onConnection("connecting");
    if (!active(current)) return;
    arm(current, 10000);
    try {
      const snapshot = await options.snapshot(signal);
      if (!active(current)) return;
      clearTimeout(watchdog);
      options.onSnapshot(snapshot);
      if (!active(current)) return;
      options.onError?.(null);
      if (!active(current)) return;
      arm(current, 30000);
      const response = await authenticatedFetch("/api/v1/events", {
        headers: { Accept: "text/event-stream" },
        cache: "no-store",
        signal,
      }, options.fetcher);
      if (!active(current)) {
        void response.body?.cancel().catch(() => {});
        return;
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new ApiError("REQUEST_FAILED", "Couldn't open the system stream.", response.status >= 500);
      }
      if (!response.body) throw new Error("The system stream is unavailable.");
      const currentReader = response.body.getReader();
      reader = currentReader;
      try {
        arm(current, 30000);
        options.onConnection("live");
        const decoder = new TextDecoder();
        // Ignore unused events without attempting to parse their payloads.
        const parse = frameParser((event, data) => {
          if (!active(current)) return;
          if (event !== "system.metrics" &&
              !(event === "operation.updated" && options.onOperation)) return;
          const value = JSON.parse(data) as unknown;
          if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error("Invalid stream event");
          if (event === "operation.updated") {
            options.onOperation?.(value as Record<string, unknown>);
          } else {
            const snapshot = value as SystemSnapshot;
            if (typeof snapshot.available !== "boolean" || typeof snapshot.timestamp !== "string")
              throw new Error("Invalid system event");
            options.onSnapshot(snapshot);
          }
        });
        while (active(current)) {
          const { done, value } = await currentReader.read();
          if (!active(current)) return;
          if (done) {
            recover();
            return;
          }
          if (value.byteLength) arm(current, 30000);
          parse(decoder.decode(value, { stream: true }));
        }
      } finally {
        if (reader === currentReader) {
          void currentReader.cancel().catch(() => {});
          reader = undefined;
        }
        currentReader.releaseLock();
      }
    } catch (error) {
      if (!active(current)) return;
      if (error instanceof ApiError && error.code === "UNAUTHORIZED") {
        unauthorized = true;
        clear();
        options.onConnection("offline");
        if (!disposed) options.onError?.("Authentication required");
        return;
      }
      options.onError?.(
        error instanceof Error ? error.message : "Couldn't reach the server.",
      );
      if (active(current)) recover();
    }
  };

  // Pause in the background and start a fresh generation on foreground.
  const visibility = () => {
    if (disposed || unauthorized) return;
    if (options.page.hidden) {
      clear();
      options.onConnection("paused");
    } else {
      void connect();
    }
  };
  // End this credential-bound stream before queued frames can reach the cache.
  const unsubscribeAuth = subscribeAuthChange(() => {
    unauthorized = true;
    clear();
  });
  options.page.addEventListener("visibilitychange", visibility);
  void connect();
  // Disposal invalidates late results before detaching the visibility listener.
  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribeAuth();
    clear();
    options.page.removeEventListener("visibilitychange", visibility);
  };
}
