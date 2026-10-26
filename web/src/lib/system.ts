export type Connection = "connecting" | "live" | "offline" | "paused";
export type Point = { timestamp: string; value: number | null };
export type CPUWindow = 10 | 30 | 60;

// appendPoint retains ordered CPU samples and null breaks within 60 seconds.
export function appendPoint(points: Point[], point: Point): Point[] {
  const time = Date.parse(point.timestamp);
  const last = points.at(-1);
  if (!Number.isFinite(time) || (last && time <= Date.parse(last.timestamp))) return points;
  return [
    ...points.filter((previous) => time - Date.parse(previous.timestamp) <= 60000),
    point,
  ].slice(-60);
}

// filterCPUWindow uses the latest buffered instant so offline history stays selectable.
export function filterCPUWindow(points: Point[], seconds: CPUWindow): Point[] {
  const last = points.at(-1);
  if (!last) return [];
  const cutoff = Date.parse(last.timestamp) - seconds * 1000;
  return points.filter((point) => Date.parse(point.timestamp) >= cutoff);
}

// formatReportedFrequency describes reported samples using decimal clock units.
export function formatReportedFrequency(hz: number | null | undefined): string {
  if (hz == null || !Number.isFinite(hz) || hz <= 0) return "—";
  for (const [scale, unit] of [[1e9, "GHz"], [1e6, "MHz"], [1e3, "kHz"]] as const) {
    if (hz >= scale) return `${(hz / scale).toFixed(2)} ${unit}`;
  }
  return `${hz.toFixed(2)} Hz`;
}

// formatBytes uses binary capacity units shared by all telemetry panels.
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}
// formatRate keeps missing counters distinct from measured zero traffic.
export function formatRate(value: number | null): string {
  return value === null ? "—" : `${formatBytes(value)}/s`;
}
// formatUptime renders elapsed time without inventing unknown durations.
export function formatUptime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return minutes > 0 ? `${minutes}m` : "<1m";
}
// connectionLabel separates transport state from host collection availability.
export function connectionLabel(
  connection: Connection,
  available: boolean,
): string {
  if (connection === "offline") return "Offline";
  if (connection === "paused") return "Paused";
  if (connection === "connecting") return "Connecting";
  return available ? "Live" : "Host data unavailable";
}
