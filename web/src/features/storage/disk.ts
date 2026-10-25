import type { StorageSnapshot } from "../../lib/api";

export type StorageDisk = StorageSnapshot["disks"][number];

// powerStateLabel preserves unknown states instead of implying disk activity.
export function powerStateLabel(state: StorageDisk["powerState"]) {
  return state === "active" ? "Active" : state === "standby" ? "Standby" : "Unknown";
}

// powerStateClass supplements the readable label with the established palette.
export function powerStateClass(state: StorageDisk["powerState"]) {
  return state === "active" ? "text-emerald-300" : state === "standby" ? "text-slate-400" : "text-amber-200";
}

// diskTemperature never treats a standby disk as having a live temperature.
export function diskTemperature(disk: StorageDisk) {
  return disk.powerState === "standby" || disk.temperature === null
    ? "—" : `${disk.temperature.toFixed(0)} °C`;
}
