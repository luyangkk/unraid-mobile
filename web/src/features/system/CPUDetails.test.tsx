// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SystemPanel } from "./SystemPanel";
import { systemSample } from "../../test/app-fixtures";
import type { SystemSnapshot } from "../../lib/api";

const extended = {
  ...systemSample,
  cpuInfo: { model: "A long processor model ".repeat(8), reportedFrequencyHz: 2450000000, logicalCPUCount: 3 },
  cpuLogicalProcessors: [
    { id: 10, usage: 100 }, { id: 2, usage: null, reason: "Collecting CPU baseline" }, { id: 0, usage: 12.34 },
  ],
};

// panel renders the real System consumer so optional extended fields reach the disclosure.
function panel(snapshot: SystemSnapshot = extended, stale = false) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<SystemPanel snapshot={snapshot} points={[]}
    networkSelection={null} onNetworkSelectionChange={() => {}}
    selectedNetwork={systemSample.networkInterfaces![0]} networkPoints={[]}
    {...{ cpuDetailsExpanded: true, onCPUDetailsExpandedChange: () => {},
      cpuWindow: 60, onCPUWindowChange: () => {}, stale }} />);
  return host;
}

it("places a full-width native CPU disclosure between the summary row and Network", () => {
  const host = panel();
  const details = host.querySelector<HTMLDetailsElement>("details")!;
  expect(details, "native CPU details").not.toBeNull();
  expect(details.open).toBe(true);
  expect(details.querySelector("summary")?.textContent).toContain("CPU details");
  expect(details.querySelector("summary")?.textContent).toContain("3 logical CPUs");
  expect(details.querySelector("summary")?.className).toContain("min-h-11");
  expect(details.parentElement?.className).not.toContain("grid-cols-2");
  expect(details.previousElementSibling?.textContent).toContain("Memory");
  expect(details.nextElementSibling?.textContent).toContain("Network");
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it("shows reported processor facts, wrapping model and a labelled native 10s/30s/60s group", () => {
  const host = panel();
  const details = host.querySelector("details")!;
  for (const value of ["Processor", extended.cpuInfo.model, "Reported frequency", "2.45", "GHz", "Logical CPUs", "3"])
    expect(details.textContent).toContain(value);
  expect(details.querySelector("dd")?.className).toContain("break-words");
  const group = details.querySelector("fieldset")!;
  expect(group.querySelector("legend")?.textContent).toBe("CPU trend window");
  const radios = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  expect(radios.map((radio) => radio.value)).toEqual(["10", "30", "60"]);
  expect(radios.map((radio) => radio.checked)).toEqual([false, false, true]);
  for (const radio of radios) expect(radio.closest("label")?.className).toContain("min-h-11");
});

it.each([
  { timestamp: "2026-10-26T12:34:56.789Z", stale: false, token: "text-text-muted" },
  { timestamp: "2026-10-26T12:34:56Z", stale: true, token: "text-stale-text-muted" },
])("shows the original sampling instant in expanded CPU details with stale=$stale", ({ timestamp, stale, token }) => {
  const host = panel({ ...extended, timestamp }, stale);
  const details = host.querySelector("details")!;
  const time = details.querySelector("time");
  expect(time, "sampling time must be inside expanded CPU details").not.toBeNull();
  expect(time!.getAttribute("datetime")).toBe(timestamp);
  expect(time!.textContent).toBe("2026-10-26 12:34:56 UTC");
  expect(time!.parentElement?.textContent).toBe("Sampled 2026-10-26 12:34:56 UTC");
  expect(time!.parentElement?.className).toContain(`text-xs ${token}`);
  expect(time!.className).toContain("tabular-nums");
  expect(time!.closest("[aria-live]")).toBeNull();
});

it("sorts stable numeric CPU IDs and exposes fixed 0–100 measurement bars without unknown zeroes", () => {
  const host = panel();
  const rows = [...host.querySelectorAll('ul[aria-label="Logical CPU usage"] li')];
  expect(rows.map((row) => row.querySelector("h4")?.textContent)).toEqual(["CPU 0", "CPU 2", "CPU 10"]);
  expect(rows[0].textContent).toContain("12.3%");
  expect(rows[1].textContent).toContain("—");
  expect(rows[1].textContent).toContain("Collecting CPU baseline");
  expect(rows[1].querySelector('[role="meter"]')).toBeNull();
  const meters = [...host.querySelectorAll('[role="meter"]')];
  expect(meters.map((meter) => meter.getAttribute("aria-label"))).toEqual(["CPU 0 usage", "CPU 10 usage"]);
  expect(meters.map((meter) => meter.getAttribute("aria-valuenow"))).toEqual(["12.34", "100"]);
  for (const meter of meters) {
    expect(meter.getAttribute("aria-valuemin")).toBe("0");
    expect(meter.getAttribute("aria-valuemax")).toBe("100");
    expect(meter.className).toContain("bg-progress-track");
    expect(meter.firstElementChild?.className).toContain("bg-progress-fill");
  }
  expect(host.querySelector('ul[aria-label="Logical CPU usage"]')?.className).toContain("grid-cols-2");
  expect(host.querySelector('[aria-live]')).toBeNull();
});

it("keeps legacy CPU summary and gives nearby reasons for missing extended fields", () => {
  const host = panel(systemSample);
  expect(host.textContent).toContain("25.0%");
  const details = host.querySelector("details")!;
  expect(details, "legacy server still offers CPU details").not.toBeNull();
  expect(details.textContent).toContain("Processor information unavailable");
  expect(details.textContent).toContain("Reported frequency unavailable");
  expect(details.textContent).toContain("Logical CPU count unavailable");
  expect(details.textContent).toContain("Logical CPU measurements unavailable");
  expect(details.querySelector('[role="meter"]')).toBeNull();
  const unavailable = panel({
    ...extended, cpuInfo: { model: null, reportedFrequencyHz: null, logicalCPUCount: null },
    cpuLogicalProcessors: [], diagnostics: { cpuModel: "cpuinfo missing", cpuFrequency: "Frequency not reported",
      cpuLogicalProcessors: "stat IDs missing" },
  });
  expect(unavailable.querySelector("dd")?.textContent).toContain("cpuinfo missing");
  expect(unavailable.querySelectorAll("dd")[1].textContent).toContain("Frequency not reported");
  expect(unavailable.querySelector("details")?.textContent).toContain("stat IDs missing");
});

it("supports 4/16/64 current CPUs without truncating rows or adding per-CPU charts", () => {
  for (const count of [4, 16, 64]) {
    const host = panel({ ...extended, cpuInfo: { ...extended.cpuInfo, logicalCPUCount: count },
      cpuLogicalProcessors: Array.from({ length: count }, (_, id) => ({ id, usage: id === 63 ? 99.99 : 0 })) });
    const rows = host.querySelectorAll('ul[aria-label="Logical CPU usage"] li');
    expect(rows).toHaveLength(count);
    if (count === 64) expect(rows[63].textContent).toContain("100.0%");
    expect(host.querySelector("details svg")).toBeNull();
    const time = host.querySelector("details time");
    expect(time, "sampling time stays nearby even with 64 logical CPUs").not.toBeNull();
    expect(time!.compareDocumentPosition(rows[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
});

it("never reuses extended metrics or old curves while System is unavailable", () => {
  const host = panel({ ...extended, available: false, reason: "Host mounts missing" });
  expect(host.textContent).toContain("Host mounts missing");
  expect(host.querySelector("details")).toBeNull();
  expect(host.querySelector('[role="meter"]')).toBeNull();
  expect(host.textContent).not.toContain(extended.cpuInfo.model);
  expect(host.querySelector("time")).toBeNull();
  expect(host.textContent).not.toContain("Sampled");
});
