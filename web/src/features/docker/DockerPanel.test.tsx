import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DockerPanel } from "./DockerPanel";
import type { DockerSnapshot } from "../../lib/api";

const sample: DockerSnapshot = {
  timestamp: "2026-10-24T00:00:00Z",
  available: true,
  containers: [
    {
      id: "plex",
      name: "Plex",
      state: "running",
      cpuUsage: 3.5,
      memoryUsedBytes: 1073741824,
      memoryLimitBytes: 2147483648,
      uptimeSeconds: 1562400,
      networkRXRate: 2048,
      networkTXRate: 1024,
      diagnostics: [],
    },
    {
      id: "backup",
      name: "Backup",
      state: "exited",
      cpuUsage: null,
      memoryUsedBytes: null,
      memoryLimitBytes: null,
      uptimeSeconds: null,
      networkRXRate: null,
      networkTXRate: null,
      diagnostics: [],
    },
    {
      id: "paused",
      name: "Database",
      state: "paused",
      cpuUsage: null,
      memoryUsedBytes: null,
      memoryLimitBytes: null,
      uptimeSeconds: null,
      networkRXRate: null,
      networkTXRate: null,
      diagnostics: ["Stats unavailable"],
    },
  ],
  summary: { running: 1, stopped: 1, other: 1 },
  diagnostics: [],
};

describe("DockerPanel", () => {
  it("renders all containers and real telemetry, with stopped containers collapsed", () => {
    const html = renderToStaticMarkup(<DockerPanel snapshot={sample} />);
    for (const value of [
      "Plex", "Backup", "Database", "Running (1)", "Stopped (1)",
      "Other (1)", "CPU 3.5%", "RAM 1.0 GiB", "18d 2h",
      "2.0 KiB/s", "1.0 KiB/s", "Paused", "Exited",
    ]) expect(html).toContain(value);
    expect(html).toMatch(/<details[^>]*open=""[^>]*><summary[^>]*>Running/);
    expect(html).toMatch(/<details class="[^"]*"><summary[^>]*>Stopped/);
    expect(html).not.toContain("Restart");
  });

  it("shows missing telemetry as unknown and preserves actual unusual states", () => {
    const html = renderToStaticMarkup(
      <DockerPanel
        snapshot={{
          ...sample,
          containers: [{ ...sample.containers[1], state: "restarting" }],
          summary: { running: 0, stopped: 0, other: 1 },
        }}
      />,
    );
    expect(html).toContain("Restarting");
    expect(html).toContain("CPU —");
    expect(html).toContain("RAM —");
    expect(html).not.toContain("CPU 0");
  });

  it("distinguishes unavailable collection from an empty Docker configuration", () => {
    const missing = renderToStaticMarkup(
      <DockerPanel snapshot={{ ...sample, available: false, reason: "Docker socket unavailable" }} />,
    );
    expect(missing).toContain("Docker socket unavailable");
    expect(missing).not.toContain("Plex");
    const empty = renderToStaticMarkup(
      <DockerPanel snapshot={{ ...sample, containers: [], summary: { running: 0, stopped: 0, other: 0 } }} />,
    );
    expect(empty).toContain("No containers configured");
    expect(empty).not.toContain("socket unavailable");
  });

  it("retains the last data and sample time on refresh failure, with diagnostics", () => {
    const html = renderToStaticMarkup(
      <DockerPanel snapshot={sample} stale errorMessage="Docker proxy denied the request" />,
    );
    expect(html).toContain("Showing the last sample");
    expect(html).toContain("Docker proxy denied the request");
    expect(html).toContain("Plex");
    expect(html).toMatch(/datetime="2026-10-24T00:00:00Z"/i);
    expect(html).toContain("Stats unavailable");
  });

  it("preserves the unavailable sample reason and time alongside a new request error", () => {
    const html = renderToStaticMarkup(
      <DockerPanel
        snapshot={{ ...sample, available: false, reason: "Socket permission denied" }}
        stale
        errorMessage="Server connection refused"
      />,
    );
    expect(html).toContain("Socket permission denied");
    expect(html).toContain("Server connection refused");
    expect(html).toMatch(/datetime="2026-10-24T00:00:00Z"/i);
    expect(html).not.toContain("Plex");
  });
});
