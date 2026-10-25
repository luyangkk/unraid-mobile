import type { SystemSnapshot } from "../../lib/api";
import { formatBytes, formatRate, type Point } from "../../lib/system";

// SystemPanel presents cached telemetry with independent status and metric colors.
export function SystemPanel({
  snapshot,
  points,
}: {
  snapshot: SystemSnapshot;
  points: Point[];
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
  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold">System</h2>
      <div className="mt-5 grid grid-cols-2 gap-6">
        <div>
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
          <Sparkline points={points} />
        </div>
        <div>
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
      <div className="mt-5 border-t border-border pt-4">
        <h3 className="text-sm text-text-muted">
          Network
          {snapshot.networkInterface ? ` · ${snapshot.networkInterface}` : ""}
        </h3>
        <div className="mt-2 flex flex-wrap justify-between gap-2 text-lg font-medium tabular-nums">
          <span>↓ {formatRate(snapshot.networkRXRate)}</span>
          <span>↑ {formatRate(snapshot.networkTXRate)}</span>
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

// Sparkline keeps metric strokes separate from brand and status semantics.
function Sparkline({ points }: { points: Point[] }) {
  if (points.length < 2)
    return <p className="mt-4 text-xs text-text-muted">Collecting trend…</p>;
  const path = points
    .map(
      (p, i) =>
        `${((i * 100) / (points.length - 1)).toFixed(1)},${(30 - Math.max(0, Math.min(100, p.value)) * 0.3).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg
      className="mt-3 h-10 w-full text-chart-line"
      viewBox="0 0 100 32"
      role="img"
      aria-label="CPU usage over the latest 60 samples"
      preserveAspectRatio="none"
    >
      <polyline
        points={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
