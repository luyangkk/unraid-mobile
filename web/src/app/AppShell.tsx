import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useRef, useState } from "react";
import { AppHeader } from "../components/app/AppHeader";
import { BottomNavigation } from "../components/app/BottomNavigation";
import { getCapabilities } from "../lib/api";
import { shouldRetryRequest } from "../lib/query";
import { rootRoute } from "./router";
import { PageDataContext, usePageActivity } from "./pageData";
import { useSystem } from "./useSystem";
import { useTabSwipe } from "./useTabSwipe";
import { TabEntryContext, useTabTransition } from "./useTabTransition";

// AppShell stays mounted across routes so authentication, stream and trend persist.
export function AppShell() {
  const [homeDockerExpanded, setHomeDockerExpanded] = useState(false);
  const main = useRef<HTMLElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const transition = useTabTransition(content, navigation);
  useTabSwipe(main, navigation, transition);
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
    <PageDataContext.Provider value={{ system, ...activity, homeDockerExpanded, setHomeDockerExpanded }}>
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-[calc(4rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))] text-foreground">
        <AppHeader snapshot={system.snapshot} connection={connection} logout={logout} refresh={() => {
          system.refresh();
          void queryClient.refetchQueries({ type: "active", predicate: (query) => query.queryKey[0] !== "system" });
        }} />
        {disconnected ? (
          <p role="alert" className="mb-4 rounded-xl border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
            {connection === "paused" ? "Updates paused. Showing the last sample." : "Connection lost. Showing the last sample; reconnecting…"}
            {system.error ? ` ${system.error}` : ""}
          </p>
        ) : null}
        {/* Include short-page whitespace and the content/nav gap in the swipe surface. */}
        <main ref={main} className="tab-swipe-surface flex min-w-0 flex-1 flex-col pb-8" style={{ touchAction: "pan-y pinch-zoom" }}>
          <motion.div ref={content} data-tab-content className="min-w-0 flex-1"
            style={{ x: transition.x, opacity: transition.opacity }}>
            <TabEntryContext.Provider value={transition.preparePage}><Outlet /></TabEntryContext.Provider>
          </motion.div>
        </main>
        <BottomNavigation navigationRef={navigation} />
      </div>
    </PageDataContext.Provider>
  );
}
