import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Dashboard } from "./App";
import type { SystemSnapshot } from "./lib/api";

const snapshot: SystemSnapshot = {
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

it("does not show the system sample time", () => {
  const client = new QueryClient();
  client.setQueryData(["system"], snapshot);

  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Dashboard />
    </QueryClientProvider>,
  );

  expect(html).toContain("Tower");
  expect(html).not.toContain("Sampled");
  expect(html).not.toContain(snapshot.timestamp);
});
