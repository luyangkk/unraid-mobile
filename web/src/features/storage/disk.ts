import type { StorageSnapshot } from "../../lib/api";

export type StorageDisk = StorageSnapshot["disks"][number];

// powerStateLabel preserves unknown states instead of implying disk activity.
export function powerStateLabel(state: StorageDisk["powerState"]) {
  return state === "active" ? "Active" : state === "standby" ? "Standby" : "Unknown";
}

// powerStateClass supplements readable labels with theme-aware status roles.
export function powerStateClass(state: StorageDisk["powerState"]) {
  return state === "active" ? "text-success" : state === "standby" ? "text-text-muted" : "text-warning";
}

// diskTemperature never treats a standby disk as having a live temperature.
export function diskTemperature(disk: StorageDisk) {
  return disk.powerState === "standby" || disk.temperature === null
    ? "—" : `${disk.temperature.toFixed(0)} °C`;
}
