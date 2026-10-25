import { createRootRouteWithContext, createRoute, createRouter, lazyRouteComponent } from "@tanstack/react-router";
import { AppShell } from "./AppShell";
import { HomePage } from "../routes/HomePage";
import { NotFoundPage } from "../routes/NotFoundPage";

export const rootRoute = createRootRouteWithContext<{ logout?: () => void }>()({
  component: AppShell,
  notFoundComponent: NotFoundPage,
});
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage });
const dockerRoute = createRoute({
  getParentRoute: () => rootRoute, path: "/docker",
  component: lazyRouteComponent(() => import("../routes/DockerPage"), "DockerPage"),
});
const vmRoute = createRoute({
  getParentRoute: () => rootRoute, path: "/vm",
  component: lazyRouteComponent(() => import("../routes/VMPage"), "VMPage"),
});
const storageRoute = createRoute({
  getParentRoute: () => rootRoute, path: "/storage",
  component: lazyRouteComponent(() => import("../routes/StoragePage"), "StoragePage"),
});
const routeTree = rootRoute.addChildren([homeRoute, dockerRoute, vmRoute, storageRoute]);

// PendingPage fills the Outlet while a lazy route chunk is being loaded.
function PendingPage() {
  return <p role="status" className="py-6 text-sm text-text-muted">Loading page…</p>;
}

// createAppRouter uses browser History while leaving server snapshots in Query Cache.
export function createAppRouter() {
  return createRouter({
    routeTree, context: {}, defaultPreload: false,
    defaultPendingMs: 0, defaultPendingMinMs: 0,
    defaultPendingComponent: PendingPage,
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register { router: ReturnType<typeof createAppRouter> }
}
