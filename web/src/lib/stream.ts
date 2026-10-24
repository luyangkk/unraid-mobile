import type { SystemSnapshot } from "./api";
import type { Connection } from "./system";

type Page = {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
};
type Options = {
  snapshot: (signal: AbortSignal) => Promise<SystemSnapshot>;
  source: () => EventSource;
  page: Page;
  onSnapshot: (snapshot: SystemSnapshot) => void;
  onConnection: (state: Connection) => void;
  onError?: (error: string | null) => void;
};

// Reconnect explicitly so every new stream is preceded by a fresh REST snapshot.
export function subscribeSystem(options: Options): () => void {
  let disposed = false,
    generation = 0;
  let controller: AbortController | undefined, source: EventSource | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined,
    watchdog: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    generation++;
    controller?.abort();
    source?.close();
    source = undefined;
    clearTimeout(retry);
    clearTimeout(watchdog);
  };
  const recover = () => {
    clear();
    if (disposed || options.page.hidden) return;
    options.onConnection("offline");
    retry = setTimeout(() => void connect(), 2000);
  };
  const arm = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(recover, 10000);
  };
  const connect = async () => {
    clear();
    if (disposed || options.page.hidden) {
      if (!disposed) options.onConnection("paused");
      return;
    }
    const current = generation;
    controller = new AbortController();
    options.onConnection("connecting");
    arm();
    try {
      const snapshot = await options.snapshot(controller.signal);
      if (disposed || generation !== current) return;
      options.onSnapshot(snapshot);
      options.onError?.(null);
      source = options.source();
      source.addEventListener("open", () => {
        if (generation === current) {
          options.onConnection("live");
          arm();
        }
      });
      source.addEventListener("system.metrics", (event) => {
        if (disposed || generation !== current) return;
        try {
          const value = JSON.parse(
            (event as MessageEvent).data,
          ) as SystemSnapshot;
          if (
            typeof value.available !== "boolean" ||
            typeof value.timestamp !== "string"
          )
            throw new Error("Invalid system event");
          options.onSnapshot(value);
          options.onConnection("live");
          arm();
        } catch {
          recover();
        }
      });
      source.addEventListener("error", () => {
        if (generation === current) recover();
      });
      arm();
    } catch (error) {
      if (disposed || generation !== current) return;
      options.onError?.(
        error instanceof Error ? error.message : "Couldn't reach the server.",
      );
      recover();
    }
  };
  const visibility = () => {
    if (options.page.hidden) {
      clear();
      options.onConnection("paused");
    } else {
      void connect();
    }
  };
  options.page.addEventListener("visibilitychange", visibility);
  void connect();
  return () => {
    disposed = true;
    clear();
    options.page.removeEventListener("visibilitychange", visibility);
  };
}
