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
it("shows real array capacity, pool capacity and clickable disk summaries", () => {
  const html = renderToStaticMarkup(<StoragePanel snapshot={sample} />);
  for (const value of [
    "Storage",
    "6.0 GiB",
    "10.0 GiB",
    "cache",
    "disk1",
    "35",
    "started",
    "idle",
    "Active",
    "Temp 35 °C",
  ])
    expect(html).toContain(value);
  expect(html).not.toContain("Adapter not connected");
  expect(html).not.toContain("Sampled");
  expect(html).not.toContain(sample.timestamp);
  expect(html).not.toContain("opacity-60");
  expect(html).not.toContain("<a ");
  expect(html).toContain('aria-label="View disk1 details"');
  expect(html).not.toContain("sdb");
});
it("shows Array, Parity and counted pool capacity summaries without disks or module diagnostics in overview", () => {
  const html = renderToStaticMarkup(
    <StoragePanel snapshot={{ ...sample, diagnostics: ["Disk I/O unavailable"] }} overview />,
  );
  for (const text of ["Array", "started", "2 data disks", "6.0 GiB", "10.0 GiB", "60.0%", "Parity", "idle", "Pools (1)", "cache", "1.0 GiB", "2.0 GiB", "50.0%"])
    expect(html).toContain(text);
  for (const text of ["Disks", "disk1", "Temp", "Read ", "Write ", "Storage diagnostics", "Disk I/O unavailable", "<a ", "<button"])
    expect(html).not.toContain(text);
});
it("summarizes each pool capacity once and counts pools rather than devices in overview", () => {
  const html = renderToStaticMarkup(
    <StoragePanel
      snapshot={{
        ...sample,
        pools: [
          sample.pools[0],
          { ...sample.pools[0], name: "fast", diskCount: 4, capacity: { totalBytes: 8 * 1024 ** 3, usedBytes: 2 * 1024 ** 3, freeBytes: 6 * 1024 ** 3 } },
        ],
      }}
      overview
    />,
  );
  for (const text of ["Pools (2)", "cache", "fast", "1.0 GiB / 2.0 GiB", "2.0 GiB / 8.0 GiB"])
    expect(html).toContain(text);
  expect(html.match(/1\.0 GiB \/ 2\.0 GiB/g)).toHaveLength(1);
  expect(html.match(/2\.0 GiB \/ 8\.0 GiB/g)).toHaveLength(1);
  expect(html).not.toContain("Pools (6)");
});
it("keeps the Disks group and diagnostics while moving I/O details out of the list", () => {
  const html = renderToStaticMarkup(
    <StoragePanel snapshot={{ ...sample, diagnostics: ["Disk I/O unavailable"] }} />,
  );
  for (const text of ["Disks (1)", "disk1", "Temp 35 °C", "Storage diagnostics", "Disk I/O unavailable"])
    expect(html).toContain(text);
  for (const text of ["Read —", "Write —", "sdb", "DISK_OK"])
    expect(html).not.toContain(text);
});
it("keeps unavailable reasons and unknown or empty capacities in overview", () => {
  const missing = renderToStaticMarkup(
    <StoragePanel snapshot={{ ...sample, available: false, reason: "Missing state mount" }} overview />,
  );
  expect(missing).toContain("Missing state mount");
  expect(missing).not.toContain("6.0 GiB");
  const stopped = renderToStaticMarkup(
    <StoragePanel snapshot={{ ...sample, array: { state: "stopped", diskCount: 2, capacity: null }, pools: [], disks: [] }} overview />,
  );
  for (const text of ["stopped", "2 data disks", "Capacity unavailable", "Pools (0)", "No pools configured"])
    expect(stopped).toContain(text);
  expect(stopped).not.toContain("0 B / 0 B");
  expect(stopped).not.toContain("Disks");
  const unknownPool = renderToStaticMarkup(
    <StoragePanel snapshot={{ ...sample, pools: [{ ...sample.pools[0], capacity: null }] }} overview />,
  );
  expect(unknownPool).toContain("cache");
  expect(unknownPool).toContain("Capacity unavailable");
});
it.each([false, true])("retains parity action and progress without inventing results in overview=%s", (overview) => {
  const html = renderToStaticMarkup(
    <StoragePanel snapshot={{ ...sample, parity: { state: "checking", action: "check", progress: 12.5 } }} overview={overview} />,
  );
  for (const text of ["checking", "check", "12.5%"])
    expect(html).toContain(text);
});
it.each([false, true])("retains and fades the last sample with its timestamp on refresh failure in overview=%s", (overview) => {
  const html = renderToStaticMarkup(
    <StoragePanel snapshot={sample} stale overview={overview} errorMessage="Storage proxy denied the request" />,
  );
  for (const text of ["Storage refresh failed.", "Showing the last sample.", "Storage proxy denied the request", "6.0 GiB", "cache", "opacity-60", "Sampled"])
    expect(html).toContain(text);
  expect(html).toContain(`<time dateTime="${sample.timestamp}">`);
});
it.each([false, true])("marks paused or offline storage stale without inventing a refresh failure in overview=%s", (overview) => {
  const html = renderToStaticMarkup(<StoragePanel snapshot={sample} stale overview={overview} />);
  for (const text of ["Showing the last sample.", "6.0 GiB", "cache", "opacity-60", "Sampled"])
    expect(html).toContain(text);
  expect(html).toContain(`<time dateTime="${sample.timestamp}">`);
  expect(html).not.toContain("refresh failed");
});
it.each([false, true])("retains stale collection reasons separately from refresh errors in overview=%s", (overview) => {
  const html = renderToStaticMarkup(
    <StoragePanel
      snapshot={{ ...sample, available: false, reason: "Missing state mount" }}
      stale
      overview={overview}
      errorMessage="Server connection refused"
    />,
  );
  for (const text of ["Missing state mount", "Storage refresh failed.", "Server connection refused", "Sampled"])
    expect(html).toContain(text);
  expect(html).toMatch(/<div class="opacity-60">[\s\S]*Missing state mount/);
  expect(html).toContain(`<time dateTime="${sample.timestamp}">`);
  expect(html).not.toContain("6.0 GiB");
});
it("allows long storage names and disk summaries to wrap at narrow widths", () => {
  const name = "verylongstoragename".repeat(8);
  const html = renderToStaticMarkup(
    <StoragePanel snapshot={{
      ...sample,
      pools: [{ ...sample.pools[0], name }],
      disks: [{ ...sample.disks[0], name, readBytesPerSecond: 123456789 * 1024 ** 4, writeBytesPerSecond: 123456789 * 1024 ** 4 }],
    }} />,
  );
  expect(html).toContain(name);
  expect(html).toMatch(/<span class="[^"]*min-w-0[^"]*break-words[^"]*">verylongstoragename/);
  expect(html).toMatch(/<button[^>]*class="[^"]*min-h-11[^"]*"/);
  expect(html).not.toContain("Read 123456789.0 TiB/s");
  expect(html).not.toContain("Write 123456789.0 TiB/s");
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
