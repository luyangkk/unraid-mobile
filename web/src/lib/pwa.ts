export type PWAStatus = "unsupported" | "registering" | "ready" | "updateAvailable" | "error";

// createPWARegistration owns registration and user consent independently of authentication.
export function createPWARegistration(options: {
  production?: boolean;
  container?: ServiceWorkerContainer;
  reload?: () => void;
} = {}) {
  const production = options.production ?? import.meta.env.PROD;
  const container = options.container ?? (typeof navigator !== "undefined" ? navigator.serviceWorker : undefined);
  const reload = options.reload ?? (() => window.location.reload());
  const listeners = new Set<() => void>();
  let status: PWAStatus = "unsupported";
  let started = false;
  let registration: ServiceWorkerRegistration | undefined;
  let dismissed: ServiceWorker | null = null;
  let reloadRequested = false;
  let reloaded = false;

  // publish notifies subscribers only when the public state changes.
  function publish(next: PWAStatus) {
    if (status === next) return;
    status = next;
    listeners.forEach((listener) => listener());
  }

  // checkWaiting preserves a dismissed worker until a different update is installed.
  function checkWaiting() {
    if (registration?.waiting && registration.waiting !== dismissed) publish("updateAvailable");
  }

  // watchInstallation handles both an in-flight install and later browser update checks.
  function watchInstallation() {
    const installing = registration?.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      if (installing.state === "installed") checkWaiting();
    });
  }

  return {
    // start contains registration failures so ordinary web startup remains unaffected.
    async start() {
      if (started || !production || !container) return;
      started = true;
      publish("registering");
      container.addEventListener("controllerchange", () => {
        if (!reloadRequested || reloaded) return;
        reloaded = true;
        reload();
      });
      try {
        registration = await container.register("/sw.js", { scope: "/", updateViaCache: "none" });
        registration.addEventListener("updatefound", watchInstallation);
        watchInstallation();
        publish("ready");
        checkWaiting();
      } catch {
        publish("error");
      }
    },
    // getSnapshot exposes registration state.
    getSnapshot: (): PWAStatus => status,
    // subscribe attaches a UI observer.
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    // dismiss leaves the current application version running.
    dismiss() {
      dismissed = registration?.waiting ?? null;
      if (status === "updateAvailable") publish("ready");
    },
    // update activates only a waiting worker explicitly accepted by this page.
    update() {
      if (status !== "updateAvailable" || reloadRequested) return;
      reloadRequested = true;
      if (registration?.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
      else if (!reloaded) {
        // Another tab may already have activated the accepted version.
        reloaded = true;
        reload();
      }
    },
  };
}

export const pwaRegistration = createPWARegistration();
