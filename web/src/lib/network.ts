import type { NetworkInterfaceSnapshot, SystemSnapshot } from "./api";

export type NetworkPoint = { timestamp: string; rx: number | null; tx: number | null };
export type TrendPoint = { timestamp: string; value: number | null };
export const trendLimits = { samples: 60, windowMs: 60000, gapMs: 3000 } as const;

// validRate treats unusable values as breaks rather than invented zero rates.
function validRate(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

// appendNetworkPoint retains selected-interface samples in a bounded time window.
export function appendNetworkPoint(points: NetworkPoint[], point: NetworkPoint): NetworkPoint[] {
  const time = Date.parse(point.timestamp);
  const last = points.at(-1);
  if (!Number.isFinite(time) || (last && time <= Date.parse(last.timestamp))) return points;
  return [
    ...points.filter((previous) => time - Date.parse(previous.timestamp) <= trendLimits.windowMs),
    { ...point, rx: validRate(point.rx), tx: validRate(point.tx) },
  ].slice(-trendLimits.samples);
}

// networkMaximum shares a zero-based scale between independent directions.
export function networkMaximum(points: NetworkPoint[]): number {
  let maximum = 0;
  for (const point of points) maximum = Math.max(maximum, validRate(point.rx) ?? 0, validRate(point.tx) ?? 0);
  return maximum || 1;
}

// trendSegments renders actual sample times without connecting missing values.
export function trendSegments(points: TrendPoint[], maximum: number): string[] {
  if (points.length < 2) return [];
  const start = Date.parse(points[0].timestamp);
  const span = Date.parse(points.at(-1)!.timestamp) - start;
  if (!Number.isFinite(span) || span <= 0) return [];
  const scale = Number.isFinite(maximum) && maximum > 0 ? maximum : 1;
  const segments: string[] = [];
  let segment: string[] = [], previousTime: number | null = null;
  for (const point of points) {
    const time = Date.parse(point.timestamp);
    const value = validRate(point.value);
    if (!Number.isFinite(time) || value === null || (previousTime !== null && time - previousTime > trendLimits.gapMs)) {
      if (segment.length) segments.push(segment.join(" "));
      segment = [];
    }
    if (Number.isFinite(time) && value !== null) {
      // Divide first so even the largest finite rate cannot overflow the SVG height.
      segment.push(`${((time - start) / span * 100).toFixed(1)},${(30 - Math.min(1, value / scale) * 30).toFixed(1)}`);
    }
    previousTime = Number.isFinite(time) ? time : null;
  }
  if (segment.length) segments.push(segment.join(" "));
  return segments;
}

// resolveNetwork chooses an interface without substituting another interface's rates.
export function resolveNetwork(snapshot: SystemSnapshot, selection: string | null): NetworkInterfaceSnapshot {
  const name = selection ?? snapshot.networkInterface;
  const entry = snapshot.networkInterfaces?.find((item) => item.name === name);
  if (!snapshot.available || !name || (!entry && (selection !== null || snapshot.networkInterfaces !== undefined))) {
    return {
      name, available: false,
      reason: !snapshot.available ? snapshot.reason : selection !== null
        ? "Selected network interface unavailable"
        : snapshot.diagnostics.networkRoute ?? snapshot.diagnostics.network ?? "Default network interface unavailable",
      rxBytesPerSecond: null, txBytesPerSecond: null,
    };
  }
  if (entry) return {
    ...entry,
    rxBytesPerSecond: entry.available ? validRate(entry.rxBytesPerSecond) : null,
    txBytesPerSecond: entry.available ? validRate(entry.txBytesPerSecond) : null,
  };
  return {
    name, available: true,
    rxBytesPerSecond: validRate(snapshot.networkRXRate),
    txBytesPerSecond: validRate(snapshot.networkTXRate),
  };
}
