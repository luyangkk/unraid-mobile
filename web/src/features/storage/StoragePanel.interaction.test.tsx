// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { StorageSnapshot } from "../../lib/api";
import { StoragePanel } from "./StoragePanel";
import { storageSample } from "../../test/app-fixtures";

const sample: StorageSnapshot = {
  ...storageSample,
  disks: [
    { ...storageSample.disks[0], device: "/dev/sdb",
      capacity: { totalBytes: 10 * 1024 ** 3, usedBytes: 6 * 1024 ** 3, freeBytes: 4 * 1024 ** 3 },
      readBytesPerSecond: 1024, writeBytesPerSecond: 2 * 1024 ** 2 },
    { ...storageSample.disks[0], name: "disk2", device: "/dev/sdc", role: "parity",
      filesystem: "btrfs", temperature: null, powerState: "standby",
      capacity: null, sizeBytes: 20 * 1024 ** 3 },
  ],
};
const disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// mountPanel exercises snapshot rerenders without a query or network layer.
async function mountPanel(snapshot = sample, overview = false, reduced = true) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("matchMedia", () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }));
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  // update forwards the same props a Storage query supplies on every sample.
  async function update(next: StorageSnapshot, stale = false, errorMessage?: string) {
    await act(async () => root.render(<StoragePanel snapshot={next} overview={overview} stale={stale} errorMessage={errorMessage} />));
  }
  await update(snapshot);
  disposers.push(async () => { await act(async () => root.unmount()); host.remove(); });
  return {
    host, fetcher, update,
    // open uses the public button label to select a disk.
    async open(name: string) {
      const row = host.querySelector<HTMLButtonElement>(`button[aria-label="View ${name} details"]`);
      expect(row).not.toBeNull();
      await act(async () => row!.click());
      return document.querySelector<HTMLElement>('[role="dialog"]')!;
    },
  };
}

// field reads a semantic definition-list value within the current modal.
function field(dialog: HTMLElement, label: string) {
  const term = [...dialog.querySelectorAll("dt")].find((node) => node.textContent === label);
  return term?.nextElementSibling?.textContent;
}

it("opens the selected disk with formatted capacity, temperature, filesystem, rates and exact device", async () => {
  const panel = await mountPanel();
  const dialog = await panel.open("disk1");
  expect(dialog).not.toBeNull();
  expect(dialog.textContent).toContain("disk1");
  for (const [label, value] of [
    ["Role", "data"], ["Power", "Active"], ["Used", "6.0 GiB"], ["Available", "4.0 GiB"],
    ["Total", "10.0 GiB"], ["Filesystem", "xfs"], ["Filesystem status", "Mounted"],
    ["Read", "1.0 KiB/s"], ["Write", "2.0 MiB/s"], ["Device", "/dev/sdb"],
  ]) expect(field(dialog, label)).toBe(value);
  expect(dialog.textContent).toContain("Temp 35 °C");
  expect(dialog.querySelector("time")?.getAttribute("datetime")).toBe(sample.timestamp);
  expect(panel.fetcher).not.toHaveBeenCalled();
});

it("keeps two disks separate across closing and reopening", async () => {
  const panel = await mountPanel();
  let dialog = await panel.open("disk1");
  expect(field(dialog, "Device")).toBe("/dev/sdb");
  await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="Close sheet"]')!.click());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); });
  dialog = await panel.open("disk2");
  expect(field(dialog, "Device")).toBe("/dev/sdc");
  expect(field(dialog, "Filesystem")).toBe("btrfs");
  expect(field(dialog, "Total")).toBe("20.0 GiB");
  expect(dialog.textContent).not.toContain("/dev/sdb");
  expect(dialog.textContent).not.toContain("6.0 GiB");
});

it("shows unknown metadata and rates without inventing zero values", async () => {
  const panel = await mountPanel({ ...sample, disks: [{
    ...sample.disks[0], role: "", device: "", filesystem: "", filesystemStatus: "",
    capacity: null, sizeBytes: null, temperature: null, powerState: "unknown",
    readBytesPerSecond: null, writeBytesPerSecond: null,
  }] });
  const dialog = await panel.open("disk1");
  for (const label of ["Role", "Used", "Available", "Total", "Filesystem", "Filesystem status", "Read", "Write", "Device"])
    expect(field(dialog, label)).toBe("—");
  expect(field(dialog, "Power")).toBe("Unknown");
  expect(dialog.textContent).toContain("Temp —");
  expect(dialog.textContent).not.toContain("0 °C");
});

it("suppresses even a reported temperature for a standby disk in both row and sheet", async () => {
  const panel = await mountPanel({ ...sample, disks: [{ ...sample.disks[1], temperature: 35 }] });
  expect(panel.host.textContent).toContain("Temp —");
  expect(panel.host.textContent).not.toContain("35 °C");
  const dialog = await panel.open("disk2");
  expect(field(dialog, "Power")).toBe("Standby");
  expect(dialog.textContent).toContain("Temp —");
  expect(dialog.textContent).not.toContain("35 °C");
});

it("updates the open sheet by name when a new snapshot reorders disks", async () => {
  const panel = await mountPanel();
  const dialog = await panel.open("disk1");
  const next = { ...sample, timestamp: "2026-10-25T01:00:00Z", disks: [
    sample.disks[1], { ...sample.disks[0], temperature: 41, readBytesPerSecond: 4096 },
  ] };
  await panel.update(next);
  expect(document.querySelector('[role="dialog"]')).toBe(dialog);
  expect(dialog.textContent).toContain("Temp 41 °C");
  expect(field(dialog, "Read")).toBe("4.0 KiB/s");
  expect(field(dialog, "Device")).toBe("/dev/sdb");
  expect(dialog.querySelector("time")?.getAttribute("datetime")).toBe(next.timestamp);
});

it("removes old details when the selected disk disappears and restores a usable focus target", async () => {
  const panel = await mountPanel();
  const dialog = await panel.open("disk1");
  await panel.update({ ...sample, disks: [sample.disks[1]] });
  expect(document.querySelector('[role="dialog"]')).toBe(dialog);
  expect(dialog.textContent).toContain("磁盘已不在最新快照中");
  expect(dialog.textContent).not.toContain("/dev/sdb");
  expect(dialog.querySelector("dl")).toBeNull();
  await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="Close sheet"]')!.click());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement?.textContent).toBe("Disks (1)");
});

it("stops showing disk details when collection becomes unavailable", async () => {
  const panel = await mountPanel();
  const dialog = await panel.open("disk1");
  await panel.update({ ...sample, available: false, reason: "Storage data unavailable" });
  expect(dialog.querySelector("dl")).toBeNull();
  expect(dialog.textContent).toContain("Storage data unavailable");
  expect(dialog.textContent).not.toContain("/dev/sdb");
});

it("resolves focus after a poll removes the trigger during the close animation", async () => {
  const panel = await mountPanel(sample, false, false);
  const dialog = await panel.open("disk1");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
  await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="Close sheet"]')!.click());
  expect(document.querySelector('[role="dialog"]')).toBe(dialog);
  await panel.update({ ...sample, disks: [sample.disks[1]] });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(document.activeElement?.textContent).toBe("Disks (1)");
});

it("reflects stale/error state and clears it after a successful new sample", async () => {
  const panel = await mountPanel();
  const dialog = await panel.open("disk1");
  await panel.update(sample, true, "Storage proxy unavailable");
  expect(dialog.textContent).toContain("Showing the last sample.");
  expect(dialog.textContent).toContain("Storage refresh failed.");
  expect(dialog.textContent).toContain("Storage proxy unavailable");
  expect(dialog.querySelector(".opacity-60")).not.toBeNull();
  expect(dialog.querySelector("time")?.textContent).toBe(sample.timestamp);
  await panel.update(sample, true);
  expect(dialog.textContent).not.toContain("refresh failed");
  await panel.update({ ...sample, timestamp: "2026-10-25T01:00:00Z" });
  expect(dialog.textContent).not.toContain("Showing the last sample.");
  expect(dialog.querySelector(".opacity-60")).toBeNull();
});

it("keeps Home overview free of disk triggers and sheets", async () => {
  const panel = await mountPanel(sample, true);
  expect(panel.host.querySelector("button")).toBeNull();
  expect(panel.host.textContent).not.toContain("disk1");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
