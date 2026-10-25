import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Outlet, useRouter } from "@tanstack/react-router";
import { animate, motion, useMotionValue } from "motion/react";
import { useLayoutEffect, useRef } from "react";
import { AppHeader } from "../components/app/AppHeader";
import { BottomNavigation } from "../components/app/BottomNavigation";
import { getCapabilities } from "../lib/api";
import { shouldRetryRequest } from "../lib/query";
import { tabMotion, useReducedMotion } from "../lib/motion";
import { primaryNavigation } from "../components/app/primaryNavigation";
import { rootRoute } from "./router";
import { PageDataContext, usePageActivity } from "./pageData";
import { useSystem } from "./useSystem";
import { useTabSwipe } from "./useTabSwipe";

// AppShell stays mounted across routes so authentication, stream and trend persist.
export function AppShell() {
  const main = useRef<HTMLElement>(null);
  const navigation = useRef<HTMLElement>(null);
  useTabSwipe(main, navigation);
  const router = useRouter();
  const reduced = useReducedMotion();
  const opacity = useMotionValue(1);
  const committedPath = useRef(router.state.location.pathname);
  useLayoutEffect(() => {
    opacity.stop();
    opacity.set(1);
    const unsubscribe = router.subscribe("onRendered", ({ toLocation }) => {
      const path = toLocation.pathname;
      if (committedPath.current === path) return;
      committedPath.current = path;
      opacity.stop();
      opacity.set(1);
      if (!reduced && primaryNavigation.some(({ to }) => to === path)) {
        opacity.set(tabMotion.enter.opacity);
        void animate(opacity, 1, { duration: tabMotion.enter.duration });
      }
    });
    return () => { unsubscribe(); opacity.stop(); };
  }, [router, reduced, opacity]);
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
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-[calc(4rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))] text-slate-100">
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
        {/* Include short-page whitespace and the content/nav gap in the swipe surface. */}
        <motion.main ref={main} className="min-w-0 flex-1 pb-8" style={{ opacity, touchAction: "pan-y pinch-zoom" }}><Outlet /></motion.main>
        <BottomNavigation navigationRef={navigation} />
      </div>
    </PageDataContext.Provider>
  );
}
