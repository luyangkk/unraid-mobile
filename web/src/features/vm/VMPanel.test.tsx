import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VMPanel } from "./VMPanel";
import type { VMSnapshot } from "../../lib/api";

const sample: VMSnapshot = {
  timestamp: "2026-10-24T00:00:00Z", available: true, reason: "",
  domains: [
    { id: "one", name: "Windows 11", state: "running", vcpus: 8, memoryBytes: 16 * 1024 ** 3, uptimeSeconds: null, diagnostics: ["Uptime unavailable"] },
    { id: "two", name: "Debian", state: "shutoff", vcpus: 2, memoryBytes: 1024 ** 3, uptimeSeconds: null, diagnostics: [] },
    { id: "three", name: "Paused guest", state: "paused", vcpus: null, memoryBytes: null, uptimeSeconds: null, diagnostics: ["Assigned resources unavailable"] },
  ], summary: { running: 1, stopped: 1, other: 1 }, diagnostics: [],
};

describe("VMPanel", () => {
  it("shows assigned resources, unknown uptime and real states in distinct groups", () => {
    const html = renderToStaticMarkup(<VMPanel snapshot={sample} />);
    for (const text of ["Windows 11", "8 vCPU", "16.0 GiB", "Assigned RAM", "Uptime —", "Running (1)", "Stopped (1)", "Other (1)", "Paused", "Shut off", "vCPU —", "RAM —", "Read only"]) expect(html).toContain(text);
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Stopped/);
    expect(html).not.toMatch(/<details[^>]*open[^>]*><summary[^>]*>Stopped/);
    expect(html).not.toContain("Force Stop");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("0 vCPU");
  });

  it("distinguishes empty configuration and unavailable collection", () => {
    const empty = renderToStaticMarkup(<VMPanel snapshot={{ ...sample, domains: [], summary: { running: 0, stopped: 0, other: 0 } }} />);
    expect(empty).toContain("No virtual machines configured");
    const missing = renderToStaticMarkup(<VMPanel snapshot={{ ...sample, available: false, reason: "Read-only libvirt socket unavailable" }} />);
    expect(missing).toContain("Read-only libvirt socket unavailable");
    expect(missing).not.toContain("Windows 11");
    expect(missing).not.toContain("No virtual machines configured");
  });

  it("retains the last sample and time when refreshing fails", () => {
    const html = renderToStaticMarkup(<VMPanel snapshot={sample} stale errorMessage="VM proxy denied the request" />);
    for (const text of ["Showing the last sample", "Windows 11", "VM proxy denied the request", "Uptime unavailable"]) expect(html).toContain(text);
    expect(html).toMatch(/datetime="2026-10-24T00:00:00Z"/i);
  });

  it("keeps unknown states outside Stopped and labels them unknown", () => {
    const html = renderToStaticMarkup(<VMPanel snapshot={{ ...sample, domains: [{ ...sample.domains[0], state: "future-state" }] }} />);
    expect(html).toContain("Other (1)");
    expect(html).toContain("Unknown");
    expect(html).toContain("Running (0)");
  });

  it("uses a reported uptime when a provider supplies one", () => {
    const html = renderToStaticMarkup(<VMPanel snapshot={{ ...sample, domains: [{ ...sample.domains[0], uptimeSeconds: 23040 }] }} />);
    expect(html).toContain("Uptime 6h 24m");
  });
});
