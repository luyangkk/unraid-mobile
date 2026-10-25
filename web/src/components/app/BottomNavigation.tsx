import { Link } from "@tanstack/react-router";
import type { RefObject } from "react";
import { tabMotion } from "../../lib/motion";
import { primaryNavigation } from "./primaryNavigation";

// BottomNavigation exposes four History routes with text, focus and active markers.
export function BottomNavigation({ navigationRef }: { navigationRef?: RefObject<HTMLElement | null> }) {
  return (
    <nav ref={navigationRef} aria-label="Primary navigation" style={{ touchAction: "pan-y pinch-zoom" }}
      className="fixed inset-x-0 bottom-0 z-10 mx-auto grid max-w-md grid-cols-4 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]">
      {primaryNavigation.map(({ to, label, icon: Icon }) => (
        <Link key={to} to={to} activeOptions={{ exact: true }} preload={false}
          style={{ transitionDuration: `${tabMotion.activeColor}s` }}
          className="tab-link relative flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 border-t-2 px-1 text-xs transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-focus-ring"
          inactiveProps={{ className: "border-transparent text-text-muted" }}
          activeProps={{ "aria-current": "page", className: "border-transparent bg-surface font-semibold text-brand-text" }}>
          <Icon className="size-5" aria-hidden="true" />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
