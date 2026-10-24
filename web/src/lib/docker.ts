const runningPreferenceKey = "unraid-mobile.docker.runningCollapsed.v1";
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

// readRunningCollapsed tolerates private browsing and server-side rendering.
export function readRunningCollapsed(storage?: PreferenceStorage): boolean {
  try {
    return (storage ?? window.localStorage).getItem(runningPreferenceKey) === "true";
  } catch {
    return false;
  }
}

// saveRunningCollapsed stores only a UI preference, never a server snapshot.
export function saveRunningCollapsed(
  collapsed: boolean,
  storage?: PreferenceStorage,
): void {
  try {
    (storage ?? window.localStorage).setItem(runningPreferenceKey, String(collapsed));
  } catch {
    // Storage restrictions must not prevent expanding the container list.
  }
}
