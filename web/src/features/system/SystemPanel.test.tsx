// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SystemPanel } from "./SystemPanel";
import type { SystemSnapshot } from "../../lib/api";
import type { NetworkPoint } from "../../lib/network";
import { appendPoint, type CPUWindow, type Point } from "../../lib/system";

// cpuPoint creates synthetic instants with millisecond precision for coverage tests.
function cpuPoint(second: number, value: number | null = 25): Point {
  return { timestamp: new Date(Date.UTC(2026, 9, 26) + second * 1000).toISOString(), value };
}

const sample: SystemSnapshot = {
  timestamp: "2026-10-24T00:00:00Z",
  available: true,
  hostname: "Tower",
  uptimeSeconds: 120,
  cpuUsage: 25,
  cpuTemperature: 42,
  memoryUsedBytes: 1073741824,
  memoryTotalBytes: 2147483648,
  networkInterface: "br0",
  networkRXRate: 1048576,
  networkTXRate: null,
  diagnostics: {},
};
const networkProps = {
  networkSelection: null,
  onNetworkSelectionChange: () => {},
  selectedNetwork: { name: "br0", available: true, rxBytesPerSecond: 1048576, txBytesPerSecond: null },
  networkPoints: [],
};
it("renders actual metric values and unknown rates", () => {
  const html = renderToStaticMarkup(
    <SystemPanel snapshot={sample} points={[]} {...networkProps} />,
  );
  const host = document.createElement("div");
  host.innerHTML = html;
  for (const value of ["25.0%", "50.0%", "42.0 °C", "1.0 MiB/s", "br0", "—"])
    expect(host.textContent).toContain(value);
});
it("shows missing host mounts without rendering fake zero metrics", () => {
  const html = renderToStaticMarkup(
    <SystemPanel
      snapshot={{ ...sample, available: false, reason: "Missing host mounts" }}
      points={[]}
      {...networkProps}
    />,
  );
  expect(html).toContain("Missing host mounts");
  expect(html).toContain("/host/proc");
  expect(html).not.toContain("25.0%");
});

it("labels Auto, its resolved name and both independent rate directions with sample time", () => {
  const html = renderToStaticMarkup(<SystemPanel snapshot={sample} points={[]} {...networkProps} />);
  const host = document.createElement("div");
  host.innerHTML = html;
  const trigger = host.querySelector<HTMLButtonElement>('[aria-label^="Network interface:"]')!;
  expect(trigger).not.toBeNull();
  expect(trigger.textContent).toBe("Auto · br0");
  expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(host.querySelector("select")).toBeNull();
  expect(host.textContent).toContain("↓ Receive");
  expect(host.textContent).toContain("↑ Transmit");
  expect(host.querySelector("time")?.dateTime).toBe(sample.timestamp);
  expect(host.querySelector("time")?.textContent).toBe("2026-10-24 00:00:00 UTC");
  expect(host.textContent).toContain("Last 60s");
});

it("retains a missing selected option and reason without showing Auto rates", () => {
  const html = renderToStaticMarkup(<SystemPanel snapshot={sample} points={[]} {...networkProps}
    networkSelection="eth0"
    selectedNetwork={{ name: "eth0", available: false, reason: "Selected interface unavailable", rxBytesPerSecond: null, txBytesPerSecond: null }}
  />);
  const host = document.createElement("div");
  host.innerHTML = html;
  expect(host.querySelector('[aria-label^="Network interface:"]')?.textContent).toBe("eth0");
  expect(host.textContent).toContain("Selected interface unavailable");
  expect(host.textContent).not.toContain("1.0 MiB/s");
});

it("collects each direction independently while using a shared zero-based scale", () => {
  const networkPoints: NetworkPoint[] = [
    { timestamp: "2026-10-24T00:00:00Z", rx: 1024, tx: null },
    { timestamp: "2026-10-24T00:00:01Z", rx: 2048, tx: 4096 },
  ];
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<SystemPanel snapshot={sample} points={[]} {...networkProps} networkPoints={networkPoints} />);
  const receive = host.querySelector('svg[aria-label*="Receive"]')!;
  expect(receive).not.toBeNull();
  expect(receive.classList.contains("text-chart-line")).toBe(true);
  expect(receive.querySelector("polyline")?.getAttribute("points")).toBe("0.0,22.5 100.0,15.0");
  expect(receive.querySelector("polyline")?.getAttribute("stroke")).toBe("currentColor");
  expect(host.querySelector('svg[aria-label*="Transmit"]')).toBeNull();
  networkPoints[0].rx = 0;
  networkPoints[0].tx = 2048;
  networkPoints[1].rx = null;
  host.innerHTML = renderToStaticMarkup(<SystemPanel snapshot={sample} points={[]} {...networkProps} networkPoints={networkPoints} />);
  expect(host.querySelector('svg[aria-label*="Receive"]')).toBeNull();
  expect(host.querySelector('svg[aria-label*="Transmit"]')).not.toBeNull();
});

it("uses the same compact actual-time style for CPU without connecting long gaps", () => {
  const points = [
    { timestamp: "2026-10-24T00:00:00Z", value: 0 },
    { timestamp: "2026-10-24T00:00:01Z", value: 50 },
    { timestamp: "2026-10-24T00:00:03Z", value: 100 },
    { timestamp: "2026-10-24T00:00:07Z", value: 25 },
  ];
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<SystemPanel snapshot={sample} points={points} {...networkProps} />);
  const cpu = host.querySelector('svg[aria-label*="CPU"]')!;
  expect(cpu.classList.contains("text-chart-line")).toBe(true);
  expect([...cpu.querySelectorAll("polyline")].map((line) => line.getAttribute("points")))
    .toEqual(["0.0,30.0 14.3,15.0 42.9,0.0", "100.0,22.5"]);
});

it("contains long names and extreme rates inside shrinkable network columns", () => {
  const name = "very-long-network-interface-name".repeat(8);
  const networkPoints = [
    { timestamp: "2026-10-24T00:00:00Z", rx: Number.MAX_VALUE, tx: 0 },
    { timestamp: "2026-10-24T00:00:01Z", rx: Number.MAX_VALUE / 2, tx: 0 },
  ];
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<SystemPanel snapshot={{ ...sample, networkInterfaces: [
    { name, available: true, rxBytesPerSecond: Number.MAX_VALUE, txBytesPerSecond: 0 },
  ] }} points={[]} {...networkProps} networkSelection={name} networkPoints={networkPoints}
    selectedNetwork={{ name, available: true, rxBytesPerSecond: Number.MAX_VALUE, txBytesPerSecond: 0 }}
  />);
  expect(host.querySelector('[aria-label^="Network interface:"]')?.textContent).toBe(name);
  for (const svg of host.querySelectorAll("svg")) {
    expect(svg.parentElement?.className).toContain("min-w-0");
    expect(svg.parentElement?.textContent).not.toMatch(/NaN|Infinity/);
    expect(svg.outerHTML).not.toMatch(/NaN|Infinity/);
  }
  expect(host.querySelector('svg[aria-label*="Receive"]')).not.toBeNull();
  expect(host.querySelector('svg[aria-label*="Transmit"]')).not.toBeNull();
});

it("labels CPU temperature and selected history, with equal-height collecting and SVG states", () => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<SystemPanel snapshot={sample} points={[]} {...networkProps} />);
  const cpu = [...host.querySelectorAll("h3")].find((title) => title.textContent === "CPU")!.parentElement!;
  expect(cpu.textContent).toContain("CPU temperature");
  expect(cpu.textContent).toContain("Last 60s");
  const placeholder = [...cpu.querySelectorAll("p")].find((node) => node.textContent === "Collecting trend…")!;
  expect(placeholder.classList.contains("h-10")).toBe(true);
  expect(placeholder.classList.contains("mt-3")).toBe(true);
  host.innerHTML = renderToStaticMarkup(<SystemPanel snapshot={sample} {...networkProps}
    points={[
      { timestamp: "2026-10-24T00:00:00Z", value: 25 },
      { timestamp: "2026-10-24T00:00:01Z", value: 50 },
    ]} {...{ cpuWindow: 10 }} />);
  expect(host.querySelector('svg[aria-label*="CPU"]')?.classList.contains("h-10")).toBe(true);
  expect(host.textContent).toContain("Last 10s");
  expect(host.textContent).toContain("Collecting history…");
});

it.each<CPUWindow>([10, 30, 60])("keeps collecting history for a %ss window with a long interior gap", (cpuWindow) => {
  const points = [0, 1, cpuWindow - 1, cpuWindow].map((second) => cpuPoint(second));
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<SystemPanel snapshot={sample} points={points} {...networkProps} cpuWindow={cpuWindow} />);
  expect(host.textContent).toContain("Collecting history…");
  expect(host.querySelectorAll('svg[aria-label*="CPU"] polyline')).toHaveLength(2);
});

it.each<CPUWindow>([10, 30, 60])("keeps collecting history for a %ss window with interior null samples", (cpuWindow) => {
  const points = Array.from({ length: cpuWindow }, (_, second) =>
    cpuPoint(second, second < 2 || second >= cpuWindow - 2 ? 25 : null));
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<SystemPanel snapshot={sample} points={points} {...networkProps} cpuWindow={cpuWindow} />);
  expect(host.textContent).toContain("Collecting history…");
  expect(host.querySelectorAll('svg[aria-label*="CPU"] polyline')).toHaveLength(2);
});

it.each([0, 59])("keeps collecting history when endpoint %s is null despite a complete span", (second) => {
  const points = Array.from({ length: 60 }, (_, index) => cpuPoint(index, index === second ? null : 25));
  const html = renderToStaticMarkup(<SystemPanel snapshot={sample} points={points} {...networkProps} />);
  expect(html).toContain("Collecting history…");
});

it.each([NaN, Infinity, -1])("keeps collecting history when an interior value is unusable (%s)", (value) => {
  const points = Array.from({ length: 60 }, (_, second) => cpuPoint(second, second === 30 ? value : 25));
  const html = renderToStaticMarkup(<SystemPanel snapshot={sample} points={points} {...networkProps} />);
  expect(html).toContain("Collecting history…");
});

it.each([
  { gapMs: 3000, collecting: false, segments: 1 },
  { gapMs: 3001, collecting: true, segments: 2 },
])("uses the exact $gapMs ms gap boundary for collecting history and CPU segments", ({ gapMs, collecting, segments }) => {
  const points = [0, 1, 1 + gapMs / 1000, 5, 6, 7, 8, 9].map((second) => cpuPoint(second));
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<SystemPanel snapshot={sample} points={points} {...networkProps} cpuWindow={10} />);
  expect(host.textContent?.includes("Collecting history…")).toBe(collecting);
  expect(host.querySelectorAll('svg[aria-label*="CPU"] polyline')).toHaveLength(segments);
});

it.each<CPUWindow>([10, 30, 60])("completes continuous %ss history with the one-slot span allowance and measured zeros", (cpuWindow) => {
  let points: Point[] = [];
  for (let second = 0; second <= 60; second++) points = appendPoint(points, cpuPoint(second, 0));
  expect(points).toHaveLength(60);
  expect(Date.parse(points.at(-1)!.timestamp) - Date.parse(points[0].timestamp)).toBe(59000);
  points = points.slice(-cpuWindow);
  expect(Date.parse(points.at(-1)!.timestamp) - Date.parse(points[0].timestamp)).toBe((cpuWindow - 1) * 1000);
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<SystemPanel snapshot={sample} points={points} {...networkProps} cpuWindow={cpuWindow} />);
  expect(host.textContent).not.toContain("Collecting history…");
  expect(host.querySelectorAll('svg[aria-label*="CPU"] polyline')).toHaveLength(1);
});

it.each<CPUWindow>([10, 30, 60])("keeps collecting history just below the %ss one-slot span allowance", (cpuWindow) => {
  const points = Array.from({ length: cpuWindow }, (_, second) => cpuPoint(second === 0 ? 0.001 : second));
  const html = renderToStaticMarkup(<SystemPanel snapshot={sample} points={points} {...networkProps} cpuWindow={cpuWindow} />);
  expect(html).toContain("Collecting history…");
});

it.each<CPUWindow>([10, 30, 60])("checks collecting history over the full selected %ss duration, not the one-slot allowance", (cpuWindow) => {
  const points = [
    cpuPoint(-1.001, null),
    cpuPoint(-1, null),
    ...Array.from({ length: cpuWindow }, (_, second) => cpuPoint(second)),
  ];
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<SystemPanel snapshot={sample} points={points} {...networkProps} cpuWindow={cpuWindow} />);
  expect(host.textContent).toContain("Collecting history…");
  expect(host.querySelectorAll('svg[aria-label*="CPU"] polyline')).toHaveLength(1);
  host.innerHTML = renderToStaticMarkup(<SystemPanel snapshot={sample} points={points.filter((point) => point.value !== null)}
    {...networkProps} cpuWindow={cpuWindow} />);
  expect(host.textContent).not.toContain("Collecting history…");
});

it("splits CPU null intervals and shows only the selected buffered window at a fixed percentage scale", () => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<SystemPanel snapshot={sample} {...networkProps}
    points={[
      { timestamp: "2026-10-24T00:00:00Z", value: 99 },
      { timestamp: "2026-10-24T00:00:50Z", value: 0 },
      { timestamp: "2026-10-24T00:00:51Z", value: 50 },
      { timestamp: "2026-10-24T00:00:52Z", value: null },
      { timestamp: "2026-10-24T00:00:53Z", value: 100 },
      { timestamp: "2026-10-24T00:00:54Z", value: 25 },
      { timestamp: "2026-10-24T00:01:00Z", value: 20 },
    ]} {...{ cpuWindow: 10 }} />);
  expect([...host.querySelectorAll('svg[aria-label*="CPU"] polyline')].map((line) => line.getAttribute("points")))
    .toEqual(["0.0,30.0 10.0,15.0", "30.0,0.0 40.0,22.5", "100.0,24.0"]);
});

it("marks only stale text while keeping SVG, memory bars and unavailable status colors clear", () => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<SystemPanel snapshot={sample} {...networkProps}
    points={[
      { timestamp: "2026-10-24T00:00:00Z", value: 25 },
      { timestamp: "2026-10-24T00:00:01Z", value: 50 },
    ]} {...{ stale: true }} />);
  expect(host.querySelector(".opacity-60")).toBeNull();
  expect(host.querySelector(".text-stale-foreground")).not.toBeNull();
  expect(host.querySelector(".text-stale-text-muted")).not.toBeNull();
  expect(host.querySelector('svg[aria-label*="CPU"]')?.classList.contains("text-chart-line")).toBe(true);
  expect(host.querySelector(".bg-progress-fill")).not.toBeNull();
});
