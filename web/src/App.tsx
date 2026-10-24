import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Box, HardDrive, RefreshCw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "./components/ui/button";
import { SystemPanel } from "./features/system/SystemPanel";
import { getCapabilities, getSystem, type SystemSnapshot } from "./lib/api";
import { subscribeSystem } from "./lib/stream";
import {
  appendPoint,
  connectionLabel,
  type Connection,
  type Point,
} from "./lib/system";

const systemKey = ["system"] as const;

function App() {
  const queryClient = useQueryClient();
  const { data: snapshot } = useQuery<SystemSnapshot>({
    queryKey: systemKey,
    queryFn: ({ signal }) => getSystem(signal),
    enabled: false,
  });
  const capabilities = useQuery({
    queryKey: ["capabilities"],
    queryFn: () => getCapabilities(),
    staleTime: 30000,
  });
  const [connection, setConnection] = useState<Connection>("connecting");
  const [points, setPoints] = useState<Point[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(
    () =>
      subscribeSystem({
        snapshot: getSystem,
        source: () => new EventSource("/api/v1/events"),
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
        <Button
          variant="secondary"
          aria-label="Refresh status"
          disabled={connection === "connecting"}
          onClick={() => {
            setRevision((value) => value + 1);
            void capabilities.refetch();
          }}
        >
          <RefreshCw
            className={connection === "connecting" ? "animate-spin" : ""}
            aria-hidden="true"
          />
        </Button>
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
        <StatusCard
          icon={<Box aria-hidden="true" />}
          title="Docker"
          detail={
            capabilities.error
              ? "Capabilities unavailable"
              : capabilities.data?.docker
                ? "Available"
                : "Adapter not connected"
          }
        />
        <StatusCard
          icon={<Activity aria-hidden="true" />}
          title="VM"
          detail={
            capabilities.error
              ? "Capabilities unavailable"
              : capabilities.data?.vm
                ? "Available"
                : "Adapter not connected"
          }
        />
        <StatusCard
          icon={<HardDrive aria-hidden="true" />}
          title="Storage"
          detail="Adapter not connected"
        />
      </div>
    </main>
  );
}
function StatusCard({
  icon,
  title,
  detail,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <article className="flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="grid size-11 place-items-center rounded-xl bg-slate-800 text-cyan-300">
        {icon}
      </div>
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-0.5 text-sm text-slate-400">{detail}</p>
      </div>
    </article>
  );
}
export default App;
