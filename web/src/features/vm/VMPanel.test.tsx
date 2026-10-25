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
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("0 vCPU");
    expect(html).not.toContain("opacity-60");
    expect(html).not.toContain("Sampled");
  });

  it("shows only running VMs and their assigned resources in overview", () => {
    const html = renderToStaticMarkup(<VMPanel snapshot={sample} overview />);
    for (const text of ["1 running", "Running (1)", "Windows 11", "8 vCPU", "16.0 GiB", "Uptime —"])
      expect(html).toContain(text);
    for (const text of ["Stopped", "Other", "Debian", "Paused guest", "<a ", "<button"])
      expect(html).not.toContain(text);
  });

  it("preserves empty, no-running and disabled collection states in overview", () => {
    const empty = renderToStaticMarkup(
      <VMPanel snapshot={{ ...sample, domains: [], summary: { running: 0, stopped: 0, other: 0 } }} overview />,
    );
    expect(empty).toContain("No virtual machines configured");
    const noRunning = renderToStaticMarkup(
      <VMPanel snapshot={{ ...sample, domains: sample.domains.slice(1), summary: { running: 0, stopped: 1, other: 1 } }} overview />,
    );
    expect(noRunning).toContain("0 running");
    expect(noRunning).toContain("No running virtual machines");
    for (const text of ["No virtual machines configured", "Stopped", "Other", "Debian", "Paused guest"])
      expect(noRunning).not.toContain(text);
    const disabled = renderToStaticMarkup(
      <VMPanel snapshot={{ ...sample, available: false, reason: "VM reading disabled (VM_READ_ENABLED=false)" }} overview />,
    );
    expect(disabled).toContain("VM reading disabled (VM_READ_ENABLED=false)");
    expect(disabled).not.toContain("Windows 11");
    expect(disabled).not.toContain("No virtual machines configured");
  });

  it("wraps long VM names and wide assigned metrics within narrow cards", () => {
    const name = "verylongvirtualmachinename".repeat(8);
    const html = renderToStaticMarkup(
      <VMPanel snapshot={{ ...sample, domains: [{ ...sample.domains[0], name, vcpus: 123456789 }] }} overview />,
    );
    expect(html).toContain(name);
    expect(html).toMatch(/<h4 class="[^"]*break-words[^"]*">/);
    expect(html).toMatch(/<div class="[^"]*grid-cols-2[^"]*break-words[^"]*">/);
  });

  it("distinguishes empty configuration and unavailable collection", () => {
    const empty = renderToStaticMarkup(<VMPanel snapshot={{ ...sample, domains: [], summary: { running: 0, stopped: 0, other: 0 } }} />);
    expect(empty).toContain("No virtual machines configured");
    const missing = renderToStaticMarkup(<VMPanel snapshot={{ ...sample, available: false, reason: "Read-only libvirt socket unavailable" }} />);
    expect(missing).toContain("Read-only libvirt socket unavailable");
    expect(missing).not.toContain("Windows 11");
    expect(missing).not.toContain("No virtual machines configured");
  });

  it.each([false, true])("retains the last sample when refreshing fails in overview=%s", (overview) => {
    const html = renderToStaticMarkup(<VMPanel snapshot={sample} stale overview={overview} errorMessage="VM proxy denied the request" />);
    for (const text of ["Showing the last sample", "VM refresh failed.", "Windows 11", "VM proxy denied the request", "Uptime unavailable", "opacity-60", "Sampled"]) expect(html).toContain(text);
    expect(html).toContain(`<time dateTime="${sample.timestamp}">`);
  });

  it.each([false, true])("marks paused or offline data stale without inventing a refresh failure in overview=%s", (overview) => {
    const html = renderToStaticMarkup(<VMPanel snapshot={sample} stale overview={overview} />);
    for (const text of ["Showing the last sample.", "Windows 11", "opacity-60", "Sampled"])
      expect(html).toContain(text);
    expect(html).toContain(`<time dateTime="${sample.timestamp}">`);
    expect(html).not.toContain("refresh failed");
  });

  it.each([false, true])("retains a stale disabled reason alongside a refresh error in overview=%s", (overview) => {
    const html = renderToStaticMarkup(
      <VMPanel
        snapshot={{ ...sample, available: false, reason: "VM reading disabled" }}
        stale
        overview={overview}
        errorMessage="Server connection refused"
      />,
    );
    for (const text of ["VM reading disabled", "VM refresh failed.", "Server connection refused", "Sampled"])
      expect(html).toContain(text);
    expect(html).toMatch(/<div class="opacity-60">[\s\S]*VM reading disabled/);
    expect(html).toContain(`<time dateTime="${sample.timestamp}">`);
    expect(html).not.toContain("Windows 11");
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
