import type { NetworkInterfaceSnapshot, SystemSnapshot } from "../../lib/api";
import { formatBytes, formatRate, type Point } from "../../lib/system";
import { networkMaximum, trendSegments, type NetworkPoint, type TrendPoint } from "../../lib/network";
import { NetworkInterfaceSelector } from "./NetworkInterfaceSelector";

// SystemPanel presents cached telemetry with independent status and metric colors.
export function SystemPanel({
  snapshot,
  points,
  networkSelection,
  onNetworkSelectionChange,
  selectedNetwork,
  networkPoints,
}: {
  snapshot: SystemSnapshot;
  points: Point[];
  networkSelection: string | null;
  onNetworkSelectionChange: (selection: string | null) => void;
  selectedNetwork: NetworkInterfaceSnapshot;
  networkPoints: NetworkPoint[];
}) {
  if (!snapshot.available)
    return (
      <section
        className="rounded-2xl border border-border bg-status-tint/5 p-5"
        aria-live="polite"
      >
        <h2 className="font-semibold text-warning">Host data unavailable</h2>
        <p className="mt-2 break-words text-sm text-foreground">
          {snapshot.reason}
        </p>
        <p className="mt-3 text-sm text-text-muted">
          Add read-only host paths in the Unraid container settings: /proc →
          /host/proc and /sys → /host/sys.
        </p>
      </section>
    );
  const percent =
    snapshot.memoryTotalBytes > 0
      ? (100 * snapshot.memoryUsedBytes) / snapshot.memoryTotalBytes
      : 0;
  const maximum = networkMaximum(networkPoints);
  return (
    <section className="min-w-0 rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold">System</h2>
      <div className="mt-5 grid grid-cols-2 gap-6">
        <div className="min-w-0">
          <h3 className="text-sm text-text-muted">CPU</h3>
          <p className="mt-1 text-3xl font-semibold tabular-nums">
            {snapshot.cpuUsage === null
              ? "—"
              : `${snapshot.cpuUsage.toFixed(1)}%`}
          </p>
          <p className="mt-1 text-sm text-text-muted">
            {snapshot.cpuTemperature === null
              ? "Temperature unavailable"
              : `${snapshot.cpuTemperature.toFixed(1)} °C`}
          </p>
          <Sparkline points={points} maximum={100} label="CPU usage over the latest 60 samples" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm text-text-muted">Memory</h3>
          <p className="mt-1 text-3xl font-semibold tabular-nums">
            {percent.toFixed(1)}%
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {formatBytes(snapshot.memoryUsedBytes)} /{" "}
            {formatBytes(snapshot.memoryTotalBytes)}
          </p>
          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-progress-track">
            <div
              className="h-full rounded-full bg-progress-fill"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      </div>
      <div className="mt-5 min-w-0 border-t border-border pt-4">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h3 className="shrink-0 text-sm font-semibold">Network</h3>
          <NetworkInterfaceSelector snapshot={snapshot} selection={networkSelection}
            selectedNetwork={selectedNetwork} onSelectionChange={onNetworkSelectionChange} />
        </div>
        {!selectedNetwork.available ? <p className="mt-2 break-words text-xs text-warning">
          {selectedNetwork.reason ?? "Network interface unavailable"}
        </p> : null}
        <div className="mt-4 grid min-w-0 grid-cols-2">
          <div className="min-w-0 border-r border-border pr-4">
            <h4 className="text-xs text-text-muted">↓ Receive</h4>
            <NetworkRate value={selectedNetwork.rxBytesPerSecond} />
            <Sparkline points={networkPoints.map((point) => ({ timestamp: point.timestamp, value: point.rx }))}
              maximum={maximum} label="Receive rate over the latest 60 seconds" network />
          </div>
          <div className="min-w-0 pl-4">
            <h4 className="text-xs text-text-muted">↑ Transmit</h4>
            <NetworkRate value={selectedNetwork.txBytesPerSecond} />
            <Sparkline points={networkPoints.map((point) => ({ timestamp: point.timestamp, value: point.tx }))}
              maximum={maximum} label="Transmit rate over the latest 60 seconds" network />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-text-muted">
          <span className="shrink-0">Last 60s</span>
          <span>Sample <time className="tabular-nums" dateTime={snapshot.timestamp}>
            {snapshot.timestamp.replace("T", " ").replace(/(?:\.\d+)?Z$/, " UTC")}
          </time></span>
        </div>
      </div>
      {Object.keys(snapshot.diagnostics).length > 0 ? (
        <details className="mt-4 text-xs text-text-muted">
          <summary className="cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">Unavailable metrics</summary>
          {Object.entries(snapshot.diagnostics).map(([key, value]) => (
            <p className="mt-2 break-words" key={key}>
              {value}
            </p>
          ))}
        </details>
      ) : null}
    </section>
  );
}

// NetworkRate preserves the shared byte formatter while giving units a quieter hierarchy.
function NetworkRate({ value }: { value: number | null }) {
  const [number, unit] = formatRate(value).split(" ");
  return (
    <p className="mt-1 min-h-7 break-all text-xl font-semibold leading-7 tabular-nums">
      {number}{unit ? <> <span className="whitespace-nowrap text-xs font-normal text-text-muted">{unit}</span></> : null}
    </p>
  );
}

// Sparkline draws unsmoothed timestamped segments using the shared theme token.
function Sparkline({ points, maximum, label, network = false }: {
  points: TrendPoint[]; maximum: number; label: string; network?: boolean;
}) {
  if (points.filter((point) => point.value !== null && Number.isFinite(point.value) && point.value >= 0).length < 2)
    return <p className={`${network ? "mt-3 flex h-12 items-center" : "mt-4"} text-xs text-text-muted`}>Collecting trend…</p>;
  const segments = trendSegments(points, maximum);
  return (
    <svg
      className={`mt-3 ${network ? "h-12" : "h-10"} w-full text-chart-line`}
      viewBox="0 0 100 32"
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      {network ? <line x1="0" y1="30" x2="100" y2="30" className="text-border"
        stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" /> : null}
      {segments.map((segment, index) => <polyline
        key={index}
        points={segment}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />)}
    </svg>
  );
}
