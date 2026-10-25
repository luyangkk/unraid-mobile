import { Link } from "@tanstack/react-router";
import { Box, HardDrive, House, Monitor } from "lucide-react";

const destinations = [
  { to: "/", label: "Home", icon: House },
  { to: "/docker", label: "Docker", icon: Box },
  { to: "/vm", label: "VM", icon: Monitor },
  { to: "/storage", label: "Storage", icon: HardDrive },
] as const;

// BottomNavigation exposes four History routes with text, focus and active markers.
export function BottomNavigation() {
  return (
    <nav aria-label="Primary navigation" className="fixed inset-x-0 bottom-0 z-10 mx-auto grid max-w-md grid-cols-4 border-t border-slate-800 bg-slate-950 pb-[env(safe-area-inset-bottom)]">
      {destinations.map(({ to, label, icon: Icon }) => (
        <Link key={to} to={to} activeOptions={{ exact: true }} preload={false}
          className="flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 border-t-2 px-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-cyan-300"
          inactiveProps={{ className: "border-transparent text-slate-400" }}
          activeProps={{ "aria-current": "page", className: "border-cyan-300 bg-slate-900 font-semibold text-cyan-300" }}>
          <Icon className="size-5" aria-hidden="true" />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
