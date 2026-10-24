import { describe, expect, it } from "vitest";
import {
  appendPoint,
  formatBytes,
  formatRate,
  connectionLabel,
} from "./system";

describe("system presentation", () => {
  it("formats values without inventing missing data", () => {
    expect(formatBytes(1073741824)).toBe("1.0 GiB");
    expect(formatRate(1048576)).toBe("1.0 MiB/s");
    expect(formatRate(null)).toBe("—");
  });
  it("bounds trends and replaces duplicate samples", () => {
    let points: { timestamp: string; value: number }[] = [];
    for (let i = 0; i < 65; i++)
      points = appendPoint(points, { timestamp: String(i), value: i });
    expect(points).toHaveLength(60);
    expect(points[0].value).toBe(5);
    expect(appendPoint(points, { timestamp: "64", value: 99 })).toHaveLength(
      60,
    );
    expect(
      appendPoint(points, { timestamp: "64", value: 99 }).at(-1)?.value,
    ).toBe(99);
  });
  it("does not label a disconnected or unavailable host online", () => {
    expect(connectionLabel("offline", true)).toBe("Offline");
    expect(connectionLabel("live", false)).toBe("Host data unavailable");
    expect(connectionLabel("connecting", true)).toBe("Connecting");
    expect(connectionLabel("live", true)).toBe("Live");
  });
});
