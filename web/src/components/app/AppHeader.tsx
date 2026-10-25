import { LogOut, RefreshCw } from "lucide-react";
import { Button } from "../ui/button";
import type { SystemSnapshot } from "../../lib/api";
import { connectionLabel, type Connection } from "../../lib/system";

// AppHeader keeps server identity, connectivity and session controls on every page.
export function AppHeader({ snapshot, connection, refresh, logout }: {
  snapshot?: SystemSnapshot;
  connection: Connection;
  refresh: () => void;
  logout?: () => void;
}) {
  const live = connection === "live" && snapshot?.available;
  const uptime = snapshot?.uptimeSeconds;
  return (
    <header className="mb-7 flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-sm text-slate-400">Unraid Mobile</p>
        <h1 className="mt-1 break-words text-3xl font-bold tracking-tight">{snapshot?.hostname || "Unraid"}</h1>
        <p className={`mt-2 flex items-center gap-2 text-sm ${live ? "text-emerald-400" : "text-amber-300"}`} role="status">
          <span className={`size-2 shrink-0 rounded-full ${live ? "bg-emerald-400" : "bg-amber-300"}`} aria-hidden="true" />
          {connectionLabel(connection, snapshot?.available ?? false)}
        </p>
        {snapshot?.available && uptime != null ? (
          <p className="mt-1 text-xs text-slate-400">Uptime {Math.floor(uptime / 86400)}d {Math.floor((uptime % 86400) / 3600)}h</p>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-2">
        {logout ? <Button variant="secondary" aria-label="Clear token" onClick={logout}><LogOut aria-hidden="true" /></Button> : null}
        <Button variant="secondary" aria-label="Refresh status" disabled={connection === "connecting"} onClick={refresh}>
          <RefreshCw className={connection === "connecting" ? "animate-spin" : ""} aria-hidden="true" />
        </Button>
      </div>
    </header>
  );
}
