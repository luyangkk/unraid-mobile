import { describe, expect, it } from "vitest";
import {
  appendPoint,
  formatBytes,
  formatRate,
  formatUptime,
  connectionLabel,
  filterCPUWindow,
} from "./system";
import type { Point } from "./system";

// timestamp supplies real UTC instants for history boundary tests.
function timestamp(second: number) {
  return new Date(Date.UTC(2026, 9, 26, 0, 0, second)).toISOString();
}

describe("system presentation", () => {
  it("formats values without inventing missing data", () => {
    expect(formatBytes(1073741824)).toBe("1.0 GiB");
    expect(formatRate(1048576)).toBe("1.0 MiB/s");
    expect(formatRate(null)).toBe("—");
  });
  it("formats elapsed uptime without inventing missing or invalid data", () => {
    expect(formatUptime(null)).toBe("—");
    expect(formatUptime(-1)).toBe("—");
    expect(formatUptime(NaN)).toBe("—");
    expect(formatUptime(0)).toBe("<1m");
    expect(formatUptime(120)).toBe("2m");
    expect(formatUptime(23040)).toBe("6h 24m");
    expect(formatUptime(93600)).toBe("1d 2h");
  });
  it("bounds trends and rejects duplicate or older sample instants", () => {
    let points: Point[] = [];
    for (let i = 0; i < 65; i++)
      points = appendPoint(points, { timestamp: timestamp(i), value: i });
    expect(points).toHaveLength(60);
    expect(points[0].value).toBe(5);
    expect(appendPoint(points, { timestamp: timestamp(64), value: 99 })).toBe(points);
    expect(appendPoint(points, { timestamp: "2026-10-26T00:01:04Z", value: 99 })).toBe(points);
    expect(appendPoint(points, { timestamp: timestamp(63), value: 99 })).toBe(points);
    expect(appendPoint(points, { timestamp: "not-a-time", value: 99 })).toBe(points);
  });
  it("retains null breaks and removes samples outside the latest 60 seconds", () => {
    let points: Point[] = [];
    for (const [second, value] of [[0, 10], [1, null], [59, 20], [60, 30], [61, null]] as const)
      points = appendPoint(points, { timestamp: timestamp(second), value });
    expect(points).toEqual([
      { timestamp: timestamp(1), value: null },
      { timestamp: timestamp(59), value: 20 },
      { timestamp: timestamp(60), value: 30 },
      { timestamp: timestamp(61), value: null },
    ]);
    expect(appendPoint(points, { timestamp: timestamp(130), value: 25 }))
      .toEqual([{ timestamp: timestamp(130), value: 25 }]);
  });
  it("filters 10s/30s/60s against the buffered sample time without mutating offline history", () => {
    const points: Point[] = [0, 20, 21, 40, 41, 50, 51, 60].map((second) => ({
      timestamp: timestamp(second), value: second === 50 ? null : second,
    }));
    expect(filterCPUWindow(points, 10).map((point) => point.timestamp)).toEqual([timestamp(50), timestamp(51), timestamp(60)]);
    expect(filterCPUWindow(points, 30).map((point) => point.timestamp)).toEqual([timestamp(40), timestamp(41), timestamp(50), timestamp(51), timestamp(60)]);
    expect(filterCPUWindow(points, 60)).toEqual(points);
    expect(filterCPUWindow(points, 10)).toEqual(filterCPUWindow(points, 10));
    expect(filterCPUWindow(points, 60)).toHaveLength(8);
    expect(points[5].value).toBeNull();
    expect(filterCPUWindow([], 60)).toEqual([]);
  });
  it("does not label a disconnected or unavailable host online", () => {
    expect(connectionLabel("offline", true)).toBe("Offline");
    expect(connectionLabel("live", false)).toBe("Host data unavailable");
    expect(connectionLabel("connecting", true)).toBe("Connecting");
    expect(connectionLabel("live", true)).toBe("Live");
  });
});
