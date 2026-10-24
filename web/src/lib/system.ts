export type Connection = "connecting" | "live" | "offline" | "paused";
export type Point = { timestamp: string; value: number };
export function appendPoint(points: Point[], point: Point): Point[] {
  return [
    ...points.filter((p) => p.timestamp !== point.timestamp),
    point,
  ].slice(-60);
}
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
export function formatRate(value: number | null): string {
  return value === null ? "—" : `${formatBytes(value)}/s`;
}
export function formatUptime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return minutes > 0 ? `${minutes}m` : "<1m";
}
export function connectionLabel(
  connection: Connection,
  available: boolean,
): string {
  if (connection === "offline") return "Offline";
  if (connection === "paused") return "Paused";
  if (connection === "connecting") return "Connecting";
  return available ? "Live" : "Host data unavailable";
}
