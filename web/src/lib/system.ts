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
export function connectionLabel(
  connection: Connection,
  available: boolean,
): string {
  if (connection === "offline") return "Offline";
  if (connection === "paused") return "Paused";
  if (connection === "connecting") return "Connecting";
  return available ? "Live" : "Host data unavailable";
}
