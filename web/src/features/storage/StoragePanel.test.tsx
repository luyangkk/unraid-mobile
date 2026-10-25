import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { StoragePanel } from "./StoragePanel";
import type { StorageSnapshot } from "../../lib/api";

const sample: StorageSnapshot = {
  timestamp: "2026-10-24T00:00:00Z",
  available: true,
  source: "unraid-state-files",
  array: {
    state: "started",
    diskCount: 2,
    capacity: {
      totalBytes: 10737418240,
      usedBytes: 6442450944,
      freeBytes: 4294967296,
    },
  },
  parity: { state: "idle", action: "", progress: null },
  pools: [
    {
      name: "cache",
      state: "Mounted",
      filesystem: "btrfs",
      diskCount: 2,
      capacity: {
        totalBytes: 2147483648,
        usedBytes: 1073741824,
        freeBytes: 1073741824,
      },
    },
  ],
  disks: [
    {
      name: "disk1",
      device: "sdb",
      role: "data",
      status: "DISK_OK",
      powerState: "active",
      filesystem: "xfs",
      filesystemStatus: "Mounted",
      sizeBytes: 10737418240,
      temperature: 35,
      capacity: null,
      readBytesPerSecond: null,
      writeBytesPerSecond: null,
    },
  ],
  diagnostics: [],
};
it("shows real array capacity, pool capacity and disk details", () => {
  const html = renderToStaticMarkup(<StoragePanel snapshot={sample} />);
  for (const value of [
    "Storage",
    "6.0 GiB",
    "10.0 GiB",
    "cache",
    "disk1",
    "35",
    "xfs",
    "started",
    "idle",
    "Active",
    "Temp 35 °C",
  ])
    expect(html).toContain(value);
  expect(html).not.toContain("Adapter not connected");
  expect(html).not.toContain("Sampled");
  expect(html).not.toContain(sample.timestamp);
});
it("explains that a standby disk has no live temperature", () => {
  const html = renderToStaticMarkup(
    <StoragePanel
      snapshot={{
        ...sample,
        disks: [
          {
            ...sample.disks[0],
            powerState: "standby",
            temperature: null,
          },
        ],
      }}
    />,
  );
  expect(html).toContain("Standby");
  expect(html).toContain("Temp —");
  expect(html).not.toContain("Temperature unavailable");
  expect(html).not.toContain("Spun down");
});
it("distinguishes missing metadata, unknown capacity and an empty configuration", () => {
  const missing = renderToStaticMarkup(
    <StoragePanel
      snapshot={{ ...sample, available: false, reason: "Missing state mount" }}
    />,
  );
  expect(missing).toContain("/host/var/local/emhttp");
  expect(missing).toContain("Missing state mount");
  expect(missing).not.toContain("6.0 GiB");
  const stopped = renderToStaticMarkup(
    <StoragePanel
      snapshot={{
        ...sample,
        array: { state: "stopped", diskCount: 2, capacity: null },
        pools: [],
        disks: [],
      }}
    />,
  );
  expect(stopped).toContain("Capacity unavailable");
  expect(stopped).toContain("No pools configured");
  expect(stopped).not.toContain("0 B / 0 B");
});
