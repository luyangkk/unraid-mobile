import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./components/ui/button";
import { SystemPanel } from "./features/system/SystemPanel";
import { StoragePanel } from "./features/storage/StoragePanel";
import { DockerPanel } from "./features/docker/DockerPanel";
import { VMPanel } from "./features/vm/VMPanel";
import { SessionGate } from "./features/auth/SessionGate";
import {
  getCapabilities,
  getSystem,
  getStorage,
  getDocker,
  getVMs,
  type SystemSnapshot,
} from "./lib/api";
import { subscribeSystem } from "./lib/stream";
import { shouldRetryRequest } from "./lib/query";
import {
  appendPoint,
  connectionLabel,
  type Connection,
  type Point,
} from "./lib/system";

const systemKey = ["system"] as const;

// App admits protected data consumers only after capabilities authentication.
function App() {
  return (
    <SessionGate>{({ logout, hasToken }) => (
      <Dashboard logout={hasToken ? logout : undefined} />
    )}</SessionGate>
  );
}

// Dashboard coordinates live System data and cached Docker/VM/Storage snapshots.
export function Dashboard({ logout }: { logout?: () => void }) {
  const queryClient = useQueryClient();
  const { data: snapshot } = useQuery<SystemSnapshot>({
    queryKey: systemKey,
    queryFn: ({ signal }) => getSystem(signal),
    enabled: false,
    retry: shouldRetryRequest,
  });
  const capabilities = useQuery({
    queryKey: ["capabilities"],
    queryFn: ({ signal }) => getCapabilities(undefined, signal),
    staleTime: 30000,
    retry: shouldRetryRequest,
  });
  const storage = useQuery({
    queryKey: ["storage"],
    queryFn: ({ signal }) => getStorage(signal),
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: shouldRetryRequest,
  });
  const docker = useQuery({
    queryKey: ["docker"],
    queryFn: ({ signal }) => getDocker(signal),
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    retry: shouldRetryRequest,
  });
  const vms = useQuery({
    queryKey: ["vms"],
    queryFn: ({ signal }) => getVMs(signal),
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    retry: shouldRetryRequest,
  });
  const [connection, setConnection] = useState<Connection>("connecting");
  const [points, setPoints] = useState<Point[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(
    () =>
      subscribeSystem({
        snapshot: getSystem,
        page: document,
        onSnapshot: (value) => {
          queryClient.setQueryData(systemKey, value);
          if (value.available && value.cpuUsage !== null) {
            setPoints((previous) =>
              appendPoint(previous, {
                timestamp: value.timestamp,
                value: value.cpuUsage!,
              }),
            );
          } else if (!value.available) setPoints([]);
        },
        onConnection: setConnection,
        onError: setError,
      }),
    [queryClient, revision],
  );
  const label = connectionLabel(connection, snapshot?.available ?? false);
  const live = connection === "live" && snapshot?.available;
  const uptime = snapshot?.uptimeSeconds;
  return (
    <main className="mx-auto min-h-dvh max-w-md px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))] text-slate-100">
      <header className="mb-7 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">Unraid Mobile</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">
            {snapshot?.hostname || "Unraid"}
          </h1>
          <p
            className={`mt-2 flex items-center gap-2 text-sm ${live ? "text-emerald-400" : "text-amber-300"}`}
            role="status"
          >
            <span
              className={`size-2 rounded-full ${live ? "bg-emerald-400" : "bg-amber-300"}`}
            />
            {label}
          </p>
          {snapshot?.available && uptime != null ? (
            <p className="mt-1 text-xs text-slate-400">
              Uptime {Math.floor(uptime / 86400)}d{" "}
              {Math.floor((uptime % 86400) / 3600)}h
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
        {logout ? (
          <Button variant="secondary" aria-label="Clear token" onClick={logout}>
            <LogOut aria-hidden="true" />
          </Button>
        ) : null}
        <Button
          variant="secondary"
          aria-label="Refresh status"
          disabled={connection === "connecting"}
          onClick={() => {
            setRevision((value) => value + 1);
            void capabilities.refetch();
            void storage.refetch();
            void docker.refetch();
            void vms.refetch();
          }}
        >
          <RefreshCw
            className={connection === "connecting" ? "animate-spin" : ""}
            aria-hidden="true"
          />
        </Button>
        </div>
      </header>
      <div className="grid gap-4">
        {connection === "offline" ? (
          <p
            role="alert"
            className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-amber-200"
          >
            Connection lost. Displaying the last sample; reconnecting…
            {error ? ` ${error}` : ""}
          </p>
        ) : null}
        {snapshot ? (
          <div className={connection === "offline" ? "opacity-60" : ""}>
            <SystemPanel snapshot={snapshot} points={points} />
            {snapshot.available ? (
              <p className="mt-2 text-right text-xs text-slate-500">
                Sampled {new Date(snapshot.timestamp).toLocaleTimeString()}
              </p>
            ) : null}
          </div>
        ) : (
          <div
            className="h-60 animate-pulse rounded-2xl bg-slate-900 p-5 text-sm text-slate-400"
            role="status"
          >
            Connecting to the server…
          </div>
        )}
        {docker.data ? (
          <DockerPanel
            snapshot={docker.data}
            stale={docker.isError}
            errorMessage={docker.error?.message}
          />
        ) : (
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-lg font-semibold">Docker</h2>
            <p className="mt-2 text-sm text-slate-400" role="status">
              {docker.error ? docker.error.message : "Loading containers…"}
            </p>
          </section>
        )}
        {vms.data ? (
          <VMPanel snapshot={vms.data} stale={vms.isError || vms.isPaused} errorMessage={vms.error?.message} />
        ) : (
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-lg font-semibold">VM</h2>
            <p className="mt-2 text-sm text-slate-400" role="status">{vms.error ? vms.error.message : "Loading virtual machines…"}</p>
          </section>
        )}
        {storage.data ? (
          <StoragePanel snapshot={storage.data} stale={storage.isError} />
        ) : (
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-lg font-semibold">Storage</h2>
            <p className="mt-2 text-sm text-slate-400">
              {storage.error ? storage.error.message : "Loading storage…"}
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
export default App;
