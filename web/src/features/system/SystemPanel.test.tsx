import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SystemPanel } from "./SystemPanel";
import type { SystemSnapshot } from "../../lib/api";

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
it("renders actual metric values and unknown rates", () => {
  const html = renderToStaticMarkup(
    <SystemPanel snapshot={sample} points={[]} />,
  );
  for (const value of ["25.0%", "50.0%", "42.0 °C", "1.0 MiB/s", "br0", "—"])
    expect(html).toContain(value);
});
it("shows missing host mounts without rendering fake zero metrics", () => {
  const html = renderToStaticMarkup(
    <SystemPanel
      snapshot={{ ...sample, available: false, reason: "Missing host mounts" }}
      points={[]}
    />,
  );
  expect(html).toContain("Missing host mounts");
  expect(html).toContain("/host/proc");
  expect(html).not.toContain("25.0%");
});
