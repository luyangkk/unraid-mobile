import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { AppHeader } from "../components/app/AppHeader";
import { BottomNavigation } from "../components/app/BottomNavigation";
import { getCapabilities } from "../lib/api";
import { shouldRetryRequest } from "../lib/query";
import { rootRoute } from "./router";
import { PageDataContext, usePageActivity } from "./pageData";
import { useSystem } from "./useSystem";

// AppShell stays mounted across routes so authentication, stream and trend persist.
export function AppShell() {
  const { logout } = rootRoute.useRouteContext();
  const queryClient = useQueryClient();
  const system = useSystem();
  const activity = usePageActivity();
  useQuery({
    queryKey: ["capabilities"], queryFn: ({ signal }) => getCapabilities(undefined, signal),
    staleTime: 30000, retry: shouldRetryRequest,
  });
  const connection = !activity.online ? "offline" : !activity.foreground ? "paused" : system.connection;
  const disconnected = connection === "offline" || connection === "paused";
  return (
    <PageDataContext.Provider value={{ system, ...activity }}>
      <div className="mx-auto min-h-dvh max-w-md px-5 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))] text-slate-100">
        <AppHeader snapshot={system.snapshot} connection={connection} logout={logout} refresh={() => {
          system.refresh();
          void queryClient.refetchQueries({ type: "active", predicate: (query) => query.queryKey[0] !== "system" });
        }} />
        {disconnected ? (
          <p role="alert" className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-amber-200">
            {connection === "paused" ? "Updates paused. Showing the last sample." : "Connection lost. Showing the last sample; reconnecting…"}
            {system.error ? ` ${system.error}` : ""}
          </p>
        ) : null}
        <main className="min-w-0"><Outlet /></main>
        <BottomNavigation />
      </div>
    </PageDataContext.Provider>
  );
}
