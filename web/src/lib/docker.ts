import type { DockerContainer, DockerSnapshot } from "./api";

const runningPreferenceKeys = {
  home: "unraid-mobile.home.docker.runningCollapsed.v1",
  docker: "unraid-mobile.docker.runningCollapsed.v1",
};
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

// containerGroup preserves transitional states outside the stopped group.
export function containerGroup(state: string): "running" | "stopped" | "other" {
  if (state === "running") return "running";
  if (["exited", "created", "dead"].includes(state)) return "stopped";
  return "other";
}

// containerStateLabel presents the actual Engine state without inferred health.
export function containerStateLabel(state: string): string {
  return state ? state[0].toUpperCase() + state.slice(1) : "Unknown";
}

// formatContainerUptime keeps elapsed time compact on narrow mobile rows.
export function formatContainerUptime(seconds: number | null): string {
  if (seconds === null) return "—";
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return minutes > 0 ? `${minutes}m` : "<1m";
}

// readRunningCollapsed reads the page's preference and tolerates unavailable storage.
export function readRunningCollapsed(
  page: "home" | "docker",
  storage?: PreferenceStorage,
): boolean {
  try {
    return (storage ?? window.localStorage).getItem(runningPreferenceKeys[page]) === "true";
  } catch {
    return false;
  }
}

// saveRunningCollapsed stores only the current page's UI preference.
export function saveRunningCollapsed(
  collapsed: boolean,
  page: "home" | "docker",
  storage?: PreferenceStorage,
): void {
  try {
    (storage ?? window.localStorage).setItem(runningPreferenceKeys[page], String(collapsed));
  } catch {
    // Storage restrictions must not prevent expanding the container list.
  }
}

export type DockerOverviewItem = Pick<DockerContainer, "id" | "name" | "iconVersion"> & {
  folder?: boolean;
  iconUrl?: string;
  running?: number;
  total?: number;
};
const overviewNameOrder = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

// dockerOverviewItems mirrors FolderView2 membership using native JavaScript regex.
export function dockerOverviewItems(snapshot: DockerSnapshot): DockerOverviewItem[] {
  const claimed = new Set<string>();
  const items: DockerOverviewItem[] = [];
  for (const folder of snapshot.folders ?? []) {
    let regex: RegExp | undefined;
    try { if (folder.matchPattern) regex = new RegExp(folder.matchPattern); } catch { /* Keep explicit members when a pattern is invalid. */ }
    const explicit = new Set(folder.containerIds);
    const members = snapshot.containers.filter(container => !claimed.has(container.id) &&
      (explicit.has(container.id) || regex?.test(container.name)));
    for (const container of members) claimed.add(container.id);
    const running = members.filter(container => container.state === "running").length;
    if (running > 0) items.push({ ...folder, folder: true, running, total: members.length });
  }
  for (const container of snapshot.containers) {
    if (container.state === "running" && !claimed.has(container.id)) items.push(container);
  }
  return items.sort((a, b) => overviewNameOrder.compare(a.name, b.name) || a.id.localeCompare(b.id));
}
