import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
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
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("opacity-60");
    expect(html).not.toContain("Sampled");
  });

  it("limits overview to the running summary and rows without detail navigation", () => {
    const html = renderToStaticMarkup(<DockerPanel snapshot={sample} overview />);
    for (const text of ["1 running", "Plex"])
      expect(html).toContain(text);
    for (const text of ["Stopped", "Other", "Backup", "Database", "CPU", "RAM", "Uptime", "KiB/s", "<a ", "<button", "<details"])
      expect(html).not.toContain(text);
    expect(html).toMatch(/<ul[^>]*grid-cols-2/);
  });

  it.each([false, true])("applies the persisted Running fold only on the Docker page (overview=%s)", (overview) => {
    const values = new Map([
      ["unraid-mobile.docker.runningCollapsed.v1", String(!overview)],
      ["unraid-mobile.home.docker.runningCollapsed.v1", String(overview)],
    ]);
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => values.get(key) ?? null } });
    try {
      const html = renderToStaticMarkup(<DockerPanel snapshot={sample} overview={overview} />);
      expect(html).toContain("Plex");
      expect(html).not.toMatch(/<details[^>]*open=""[^>]*><summary[^>]*>Running/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves empty, no-running and unavailable states in overview", () => {
    const empty = renderToStaticMarkup(
      <DockerPanel snapshot={{ ...sample, containers: [], summary: { running: 0, stopped: 0, other: 0 } }} overview />,
    );
    expect(empty).toContain("No containers configured");
    const noRunning = renderToStaticMarkup(
      <DockerPanel snapshot={{ ...sample, containers: sample.containers.slice(1), summary: { running: 0, stopped: 1, other: 1 } }} overview />,
    );
    expect(noRunning).toContain("0 running");
    expect(noRunning).toContain("No running containers");
    for (const text of ["No containers configured", "Stopped", "Other", "Backup", "Database"])
      expect(noRunning).not.toContain(text);
    const unavailable = renderToStaticMarkup(
      <DockerPanel snapshot={{ ...sample, available: false, reason: "Docker socket unavailable" }} overview />,
    );
    expect(unavailable).toContain("Docker socket unavailable");
    expect(unavailable).not.toContain("Plex");
    expect(unavailable).not.toContain("No containers configured");
  });

  it("wraps long container names and large metrics on the Docker page", () => {
    const name = "verylongcontainername".repeat(8);
    const html = renderToStaticMarkup(
      <DockerPanel snapshot={{ ...sample, containers: [{ ...sample.containers[0], name, cpuUsage: 123456789.5 }] }} />,
    );
    expect(html).toContain(name);
    expect(html).toMatch(/<h4 class="[^"]*break-words[^"]*">/);
    expect(html).toMatch(/<div class="[^"]*grid-cols-2[^"]*break-words[^"]*">/);
  });

  it("naturally sorts Home without changing the cached snapshot and truncates names", () => {
    const names = ["app10", "Zebra", "app2", "Alpha", "alpha"];
    const containers = names.map((name, index) => ({ ...sample.containers[0], name, id: String(index) }));
    const html = renderToStaticMarkup(<DockerPanel snapshot={{ ...sample, containers }} overview />);
    const order = [...html.matchAll(/title="([^"]+)"/g)].map((match) => match[1]);
    expect(order).toEqual(["Alpha", "alpha", "app2", "app10", "Zebra"]);
    expect(containers.map((container) => container.name)).toEqual(names);
    expect(html).toContain('class="min-w-0 truncate');
    expect(html).not.toContain("<button");
  });

  it("limits Home to eight items with an accessible expansion control", () => {
    const containers = Array.from({ length: 11 }, (_, index) => ({
      ...sample.containers[0], id: String(index), name: `app${index + 1}`,
    }));
    const snapshot = { ...sample, containers, summary: { running: 11, stopped: 0, other: 0 } };
    const collapsed = renderToStaticMarkup(<DockerPanel snapshot={snapshot} overview />);
    expect(collapsed.match(/<li /g)).toHaveLength(8);
    expect(collapsed).toContain("Show 3 more containers");
    expect(collapsed).toContain('aria-expanded="false"');
    expect(collapsed).not.toContain('title="app9"');
    const expanded = renderToStaticMarkup(<DockerPanel snapshot={snapshot} overview overviewExpanded />);
    expect(expanded.match(/<li /g)).toHaveLength(11);
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).toContain("Show fewer containers");
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

  it("retains the last data on refresh failure, with diagnostics", () => {
    const html = renderToStaticMarkup(
      <DockerPanel snapshot={sample} stale errorMessage="Docker proxy denied the request" />,
    );
    expect(html).toContain("Showing the last sample");
    expect(html).toContain("Docker refresh failed.");
    expect(html).toContain("Docker proxy denied the request");
    expect(html).toContain("Plex");
    expect(html).toContain("opacity-60");
    expect(html).toContain("Sampled");
    expect(html).toContain(`<time dateTime="${sample.timestamp}">`);
    expect(html).toContain("Stats unavailable");
  });

  it.each([false, true])("marks paused or offline data stale without inventing a refresh failure in overview=%s", (overview) => {
    const html = renderToStaticMarkup(<DockerPanel snapshot={sample} stale overview={overview} />);
    expect(html).toContain("Showing the last sample.");
    expect(html).toContain("Plex");
    expect(html).toContain(overview ? "text-stale-foreground" : "opacity-60");
    if (overview) expect(html).not.toContain("opacity-60");
    expect(html).toContain("Sampled");
    expect(html).toContain(`<time dateTime="${sample.timestamp}">`);
    expect(html).not.toContain("refresh failed");
  });

  it.each([false, true])("preserves the unavailable sample reason alongside a new request error in overview=%s", (overview) => {
    const html = renderToStaticMarkup(
      <DockerPanel
        snapshot={{ ...sample, available: false, reason: "Socket permission denied" }}
        stale
        overview={overview}
        errorMessage="Server connection refused"
      />,
    );
    expect(html).toContain("Socket permission denied");
    expect(html).toContain("Server connection refused");
    expect(html).toContain("Docker refresh failed.");
    expect(html).toContain(overview ? "text-stale-foreground" : "opacity-60");
    expect(html).toContain("Sampled");
    expect(html).toContain(`<time dateTime="${sample.timestamp}">`);
    expect(html).not.toContain("Plex");
  });
});
