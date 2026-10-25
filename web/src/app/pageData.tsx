import { onlineManager, useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { getDocker, getStorage, getVMs } from "../lib/api";
import { shouldRetryRequest } from "../lib/query";
import type { useSystem } from "./useSystem";

export const PageDataContext = createContext<{
  system: ReturnType<typeof useSystem>;
  foreground: boolean;
  online: boolean;
  homeDockerExpanded: boolean;
  setHomeDockerExpanded: (expanded: boolean) => void;
} | null>(null);

// subscribeVisibility observes page activity without introducing another state store.
function subscribeVisibility(listener: () => void) {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}

// subscribeOnline observes TanStack's shared browser connectivity manager.
function subscribeOnline(listener: () => void) {
  return onlineManager.subscribe(listener);
}

// usePageActivity makes offline and background freshness consistent across pages.
export function usePageActivity() {
  const foreground = useSyncExternalStore(subscribeVisibility, () => !document.hidden, () => true);
  const online = useSyncExternalStore(subscribeOnline, () => onlineManager.isOnline(), () => true);
  return { foreground, online };
}

// usePageData consumes shell-owned state without putting snapshots in route state.
export function usePageData() {
  const value = useContext(PageDataContext);
  if (!value) throw new Error("Page data requires AppShell");
  return value;
}

// useSnapshot polls only while this route is mounted and visible.
function useSnapshot<T>(queryKey: readonly string[], read: (signal: AbortSignal) => Promise<T>, interval: number) {
  const { foreground, online } = usePageData();
  const query = useQuery({
    queryKey, queryFn: ({ signal }) => read(signal),
    enabled: foreground,
    refetchInterval: interval,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    retry: shouldRetryRequest,
  });
  const [awaitingFresh, setAwaitingFresh] = useState(true);
  useEffect(() => {
    if (!foreground || !online || query.isError || query.isPaused) {
      setAwaitingFresh(true);
    } else if (query.isSuccess && !query.isFetching) {
      setAwaitingFresh(false);
    }
  }, [foreground, online, query.isError, query.isPaused, query.isSuccess, query.isFetching]);
  return { ...query, stale: awaitingFresh || query.isError || query.isPaused || !online || !foreground };
}

// useDockerSnapshot shares Docker cache between Home and the detail route.
export function useDockerSnapshot() {
  return useSnapshot(["docker"], getDocker, 2000);
}

// useVMSnapshot shares VM cache while retaining its three-second interval.
export function useVMSnapshot() {
  return useSnapshot(["vms"], getVMs, 3000);
}

// useStorageSnapshot shares Storage cache without retaining hidden route observers.
export function useStorageSnapshot() {
  return useSnapshot(["storage"], getStorage, 2000);
}
