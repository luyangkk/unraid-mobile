import type { NetworkInterfaceSnapshot, SystemSnapshot } from "../../lib/api";
import { filterCPUWindow, formatBytes, formatRate, type CPUWindow, type Point } from "../../lib/system";
import { networkMaximum, trendLimits, trendSegments, type NetworkPoint, type TrendPoint } from "../../lib/network";
import { NetworkInterfaceSelector } from "./NetworkInterfaceSelector";
import { CPUDetails } from "./CPUDetails";

// SystemPanel presents cached telemetry with independent status and metric colors.
export function SystemPanel({
  snapshot,
  points,
  networkSelection,
  onNetworkSelectionChange,
  selectedNetwork,
  networkPoints,
  cpuDetailsExpanded = false,
  onCPUDetailsExpandedChange,
  cpuWindow = 60,
  onCPUWindowChange,
  stale = false,
}: {
  snapshot: SystemSnapshot;
  points: Point[];
  networkSelection: string | null;
  onNetworkSelectionChange: (selection: string | null) => void;
  selectedNetwork: NetworkInterfaceSnapshot;
  networkPoints: NetworkPoint[];
  cpuDetailsExpanded?: boolean;
  onCPUDetailsExpandedChange?: (expanded: boolean) => void;
  cpuWindow?: CPUWindow;
  onCPUWindowChange?: (seconds: CPUWindow) => void;
  stale?: boolean;
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
  const cpuPoints = filterCPUWindow(points, cpuWindow);
  const cpuHistoryComplete = cpuPoints.length >= 2
    && Date.parse(cpuPoints.at(-1)!.timestamp) - Date.parse(cpuPoints[0].timestamp) >= (cpuWindow - 1) * 1000
    && cpuPoints.every((point, index) => point.value !== null && Number.isFinite(point.value) && point.value >= 0
      && (index === 0 || Date.parse(point.timestamp) - Date.parse(cpuPoints[index - 1].timestamp) <= trendLimits.gapMs));
  const muted = stale ? "text-stale-text-muted" : "text-text-muted";
  return (
    <section className={`min-w-0 rounded-2xl border border-border bg-surface p-5 ${stale ? "text-stale-foreground" : "text-foreground"}`}>
      <h2 className="text-lg font-semibold">System</h2>
      <div className="mt-5 grid grid-cols-2 gap-6">
        <div className="min-w-0">
          <h3 className={`text-sm ${muted}`}>CPU</h3>
          <p className="mt-1 text-3xl font-semibold tabular-nums">
            {snapshot.cpuUsage === null
              ? "—"
              : `${snapshot.cpuUsage.toFixed(1)}%`}
          </p>
          <p className={`mt-1 text-xs ${muted}`}>
            CPU temperature{" "}
            {snapshot.cpuTemperature === null
              ? "—"
              : <span className="whitespace-nowrap">{snapshot.cpuTemperature.toFixed(1)} °C</span>}
          </p>
          <Sparkline points={cpuPoints} maximum={100} label={`CPU usage over the latest ${cpuWindow} seconds`} stale={stale} />
          <p className={`mt-2 text-xs ${muted}`}>Last {cpuWindow}s</p>
          {!cpuHistoryComplete
            ? <p className={`mt-1 text-xs ${muted}`}>Collecting history…</p> : null}
        </div>
        <div className="min-w-0">
          <h3 className={`text-sm ${muted}`}>Memory</h3>
          <p className="mt-1 text-3xl font-semibold tabular-nums">
            {percent.toFixed(1)}%
          </p>
          <p className={`mt-1 text-xs ${muted}`}>
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
      <CPUDetails snapshot={snapshot} expanded={cpuDetailsExpanded} onExpandedChange={onCPUDetailsExpandedChange}
        window={cpuWindow} onWindowChange={onCPUWindowChange} stale={stale} />
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
            <h4 className={`text-xs ${muted}`}>↓ Receive</h4>
            <NetworkRate value={selectedNetwork.rxBytesPerSecond} stale={stale} />
            <Sparkline points={networkPoints.map((point) => ({ timestamp: point.timestamp, value: point.rx }))}
              maximum={maximum} label="Receive rate over the latest 60 seconds" network stale={stale} />
          </div>
          <div className="min-w-0 pl-4">
            <h4 className={`text-xs ${muted}`}>↑ Transmit</h4>
            <NetworkRate value={selectedNetwork.txBytesPerSecond} stale={stale} />
            <Sparkline points={networkPoints.map((point) => ({ timestamp: point.timestamp, value: point.tx }))}
              maximum={maximum} label="Transmit rate over the latest 60 seconds" network stale={stale} />
          </div>
        </div>
        <div className={`mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs ${muted}`}>
          <span className="shrink-0">Last 60s</span>
          <span>Sample <time className="tabular-nums" dateTime={snapshot.timestamp}>
            {snapshot.timestamp.replace("T", " ").replace(/(?:\.\d+)?Z$/, " UTC")}
          </time></span>
        </div>
      </div>
      {Object.keys(snapshot.diagnostics).length > 0 ? (
        <details className={`mt-4 text-xs ${muted}`}>
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
function NetworkRate({ value, stale }: { value: number | null; stale: boolean }) {
  const [number, unit] = formatRate(value).split(" ");
  return (
    <p className="mt-1 min-h-7 break-all text-xl font-semibold leading-7 tabular-nums">
      {number}{unit ? <> <span className={`whitespace-nowrap text-xs font-normal ${stale ? "text-stale-text-muted" : "text-text-muted"}`}>{unit}</span></> : null}
    </p>
  );
}

// Sparkline draws unsmoothed timestamped segments using the shared theme token.
function Sparkline({ points, maximum, label, network = false, stale }: {
  points: TrendPoint[]; maximum: number; label: string; network?: boolean; stale: boolean;
}) {
  if (points.filter((point) => point.value !== null && Number.isFinite(point.value) && point.value >= 0).length < 2)
    return <p className={`mt-3 flex ${network ? "h-12" : "h-10"} items-center text-xs ${stale ? "text-stale-text-muted" : "text-text-muted"}`}>Collecting trend…</p>;
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
