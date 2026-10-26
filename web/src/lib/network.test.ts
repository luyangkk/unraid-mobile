import { describe, expect, it } from "vitest";
import type { SystemSnapshot } from "./api";
import { appendNetworkPoint, networkMaximum, resolveNetwork, trendSegments, type NetworkPoint } from "./network";
import { systemSample } from "../test/app-fixtures";

// point creates timestamped synthetic counters without relying on wall-clock time.
function point(second: number, rx: number | null = 10, tx: number | null = 20): NetworkPoint {
  return { timestamp: new Date(Date.UTC(2026, 9, 24, 0, 0, second)).toISOString(), rx, tx };
}

describe("selected network history", () => {
  it("retains at most 60 points and expires points outside the latest 60 seconds", () => {
    let points: NetworkPoint[] = [];
    for (let second = 0; second < 65; second++) points = appendNetworkPoint(points, point(second));
    expect(points).toHaveLength(60);
    expect(points[0].timestamp).toBe("2026-10-24T00:00:05.000Z");
    expect(appendNetworkPoint(points, point(125))).toEqual([point(125)]);
    expect(appendNetworkPoint([point(0)], point(60))).toHaveLength(2);
  });

  it("rejects duplicate instants, invalid dates and out-of-order events", () => {
    const points = [point(1), point(2)];
    for (const next of [point(1, 999), point(2, 999), { ...point(2), timestamp: "2026-10-24T00:00:02Z" }, { ...point(3), timestamp: "invalid" }])
      expect(appendNetworkPoint(points, next)).toBe(points);
  });

  it("keeps null breaks and normalizes invalid rates independently", () => {
    expect(appendNetworkPoint([], point(1, null, 0))).toEqual([point(1, null, 0)]);
    expect(appendNetworkPoint([], point(1, Infinity, 20))).toEqual([point(1, null, 20)]);
    expect(appendNetworkPoint([], point(1, 20, -1))).toEqual([point(1, 20, null)]);
  });
});

describe("trend geometry", () => {
  it("shares the valid RX/TX maximum with a nonzero fallback for zeros or nulls", () => {
    expect(networkMaximum([point(1, 1048576, 4194304), point(2, null, 2097152)])).toBe(4194304);
    expect(networkMaximum([point(1, 0, 0), point(2, null, null)])).toBe(1);
    expect(networkMaximum([point(1, Infinity, -1)])).toBe(1);
  });

  it("positions X by actual timestamps and scales rates without a CPU clamp", () => {
    expect(trendSegments([
      { timestamp: point(0).timestamp, value: 0 },
      { timestamp: point(1).timestamp, value: 512 },
      { timestamp: point(3).timestamp, value: 1024 },
    ], 2048)).toEqual(["0.0,30.0 33.3,22.5 100.0,15.0"]);
  });

  it("splits nulls and gaps greater than three seconds without interpolation", () => {
    expect(trendSegments([
      { timestamp: point(0).timestamp, value: 10 },
      { timestamp: point(1).timestamp, value: null },
      { timestamp: point(2).timestamp, value: 10 },
      { timestamp: point(3).timestamp, value: 10 },
      { timestamp: point(7).timestamp, value: 10 },
      { timestamp: point(8).timestamp, value: 10 },
    ], 20)).toEqual(["0.0,15.0", "25.0,15.0 37.5,15.0", "87.5,15.0 100.0,15.0"]);
  });

  it("keeps finite geometry for the largest finite rates and all-zero lines", () => {
    const values = [0, Number.MAX_VALUE / 2, Number.MAX_VALUE];
    expect(trendSegments(values.map((value, second) => ({ timestamp: point(second).timestamp, value })), Number.MAX_VALUE))
      .toEqual(["0.0,30.0 50.0,15.0 100.0,0.0"]);
    expect(trendSegments([0, 1].map((second) => ({ timestamp: point(second).timestamp, value: 0 })), 1))
      .toEqual(["0.0,30.0 100.0,30.0"]);
  });
});

describe("interface resolution", () => {
  const snapshot: SystemSnapshot = {
    ...systemSample,
    networkInterfaces: [
      { name: "br0", available: true, rxBytesPerSecond: 1024, txBytesPerSecond: 2048 },
      { name: "eth0", available: true, rxBytesPerSecond: 4096, txBytesPerSecond: null },
      { name: "bad0", available: false, reason: "Malformed counters", rxBytesPerSecond: null, txBytesPerSecond: null },
    ],
  };

  it("resolves Auto and manual rates from their own entries", () => {
    expect(resolveNetwork(snapshot, null)).toEqual(snapshot.networkInterfaces![0]);
    expect(resolveNetwork(snapshot, "eth0")).toEqual(snapshot.networkInterfaces![1]);
    expect(resolveNetwork(snapshot, "bad0")).toEqual(snapshot.networkInterfaces![2]);
  });

  it("does not substitute legacy or Auto rates for a disappeared manual choice", () => {
    expect(resolveNetwork(snapshot, "missing")).toMatchObject({
      name: "missing", available: false, reason: expect.stringMatching(/unavailable/i),
      rxBytesPerSecond: null, txBytesPerSecond: null,
    });
    expect(resolveNetwork({ ...snapshot, networkInterfaces: [] }, null).available).toBe(false);
  });

  it("allows old-server Auto but never seeds a manual choice from legacy rates", () => {
    const legacy = { ...systemSample, networkInterfaces: undefined };
    expect(resolveNetwork(legacy, null)).toMatchObject({
      name: "br0", available: true, rxBytesPerSecond: 1048576, txBytesPerSecond: null,
    });
    expect(resolveNetwork(legacy, "eth0").rxBytesPerSecond).toBeNull();
  });

  it("keeps readable manual interfaces when Auto has no route and masks whole-host failure", () => {
    expect(resolveNetwork({ ...snapshot, networkInterface: "" }, null).available).toBe(false);
    expect(resolveNetwork({ ...snapshot, networkInterface: "" }, "eth0").available).toBe(true);
    expect(resolveNetwork({ ...snapshot, available: false, reason: "Host read failed" }, "eth0"))
      .toMatchObject({ name: "eth0", available: false, reason: "Host read failed", rxBytesPerSecond: null, txBytesPerSecond: null });
  });
});
