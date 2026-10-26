import type { NetworkInterfaceSnapshot, SystemSnapshot } from "../../lib/api";
import { formatBytes, formatRate, type Point } from "../../lib/system";
import { networkMaximum, trendSegments, type NetworkPoint, type TrendPoint } from "../../lib/network";

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
  const interfaces = snapshot.networkInterfaces ?? [];
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
        <h3 className="break-all text-sm text-text-muted">
          Network
          {selectedNetwork.name ? ` · ${selectedNetwork.name}` : ""}
        </h3>
        <label htmlFor="network-interface" className="mt-3 block text-xs text-text-muted">Network interface</label>
        <select id="network-interface" value={networkSelection ?? ""}
          onChange={(event) => onNetworkSelectionChange(event.target.value || null)}
          className="mt-1 min-h-11 w-full min-w-0 max-w-full truncate rounded-lg border border-control-border bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <option value="">Auto</option>
          {interfaces.map((entry) => <option key={entry.name} value={entry.name}>{entry.name}</option>)}
          {networkSelection !== null && !interfaces.some((entry) => entry.name === networkSelection)
            ? <option value={networkSelection}>{networkSelection} (unavailable)</option> : null}
        </select>
        {!selectedNetwork.available ? <p className="mt-2 break-words text-xs text-warning">
          {selectedNetwork.reason ?? "Network interface unavailable"}
        </p> : null}
        <div className="mt-3 grid min-w-0 grid-cols-2 gap-4">
          <div className="min-w-0">
            <h4 className="text-xs text-text-muted">↓ Receive</h4>
            <p className="mt-1 break-all text-lg font-medium tabular-nums">{formatRate(selectedNetwork.rxBytesPerSecond)}</p>
            <Sparkline points={networkPoints.map((point) => ({ timestamp: point.timestamp, value: point.rx }))}
              maximum={maximum} label="Receive rate over the latest 60 seconds" />
          </div>
          <div className="min-w-0">
            <h4 className="text-xs text-text-muted">↑ Transmit</h4>
            <p className="mt-1 break-all text-lg font-medium tabular-nums">{formatRate(selectedNetwork.txBytesPerSecond)}</p>
            <Sparkline points={networkPoints.map((point) => ({ timestamp: point.timestamp, value: point.tx }))}
              maximum={maximum} label="Transmit rate over the latest 60 seconds" />
          </div>
        </div>
        <p className="mt-3 break-all text-xs text-text-muted">Sample time <time dateTime={snapshot.timestamp}>{snapshot.timestamp}</time></p>
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

// Sparkline draws unsmoothed timestamped segments using the shared theme token.
function Sparkline({ points, maximum, label }: { points: TrendPoint[]; maximum: number; label: string }) {
  if (points.filter((point) => point.value !== null && Number.isFinite(point.value) && point.value >= 0).length < 2)
    return <p className="mt-4 text-xs text-text-muted">Collecting trend…</p>;
  const segments = trendSegments(points, maximum);
  return (
    <svg
      className="mt-3 h-10 w-full text-chart-line"
      viewBox="0 0 100 32"
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
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
