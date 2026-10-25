import { useEffect, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { pwaRegistration } from "../../lib/pwa";
import { Button } from "../ui/button";

// PWAUpdateBanner keeps optional updates independent of the authentication gate.
export function PWAUpdateBanner({ registration = pwaRegistration }: { registration?: typeof pwaRegistration }) {
  const status = useSyncExternalStore(registration.subscribe, registration.getSnapshot, registration.getSnapshot);
  const [updating, setUpdating] = useState(false);
  useEffect(() => { void registration.start(); }, [registration]);
  if (status !== "updateAvailable") return null;
  return (
    <aside className="mx-auto max-w-md px-5 pt-[calc(1rem+env(safe-area-inset-top))]">
      <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-3 text-foreground">
        <p className="min-w-0 flex-1 text-sm text-info">New version available.</p>
        <Button aria-label="Refresh to update" disabled={updating} onClick={() => {
          setUpdating(true);
          registration.update();
        }}>{updating ? "Updating…" : "Refresh"}</Button>
        <Button variant="secondary" aria-label="Dismiss update" disabled={updating} onClick={registration.dismiss} className="min-w-11 px-3">
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </aside>
  );
}
