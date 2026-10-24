import { Activity, Box, Cpu, HardDrive, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "./components/ui/button";
import { ApiError, type Capabilities, getCapabilities } from "./lib/api";

function App() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = async () => {
    setIsLoading(true);
    try {
      setCapabilities(await getCapabilities());
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError("NETWORK_ERROR", "Couldn't reach the server.", true));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <main className="mx-auto min-h-dvh max-w-md bg-slate-950 px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))] text-slate-100">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-400">Unraid Mobile</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Tower</h1>
          <p className="mt-2 flex items-center gap-2 text-sm text-emerald-400">
            <span className="size-2 rounded-full bg-emerald-400" /> Online
          </p>
        </div>
        <Button variant="secondary" aria-label="Refresh status" onClick={() => void refresh()} disabled={isLoading}>
          <RefreshCw className={isLoading ? "animate-spin" : ""} aria-hidden="true" />
        </Button>
      </header>

      {error ? (
        <section className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4" aria-live="polite">
          <p className="font-semibold text-rose-200">{error.message}</p>
          <p className="mt-1 text-sm text-rose-100/80">{error.retryable ? "Check the connection and try again." : error.code}</p>
        </section>
      ) : (
        <section className="grid gap-3" aria-busy={isLoading}>
          <StatusCard icon={<Cpu aria-hidden="true" />} title="System" detail="Waiting for host metrics" />
          <StatusCard icon={<Box aria-hidden="true" />} title="Docker" detail={capabilities?.docker ? "Available" : "Unavailable on this system"} />
          <StatusCard icon={<Activity aria-hidden="true" />} title="VM" detail={capabilities?.vm ? "Available" : "Unavailable on this system"} />
          <StatusCard icon={<HardDrive aria-hidden="true" />} title="Storage" detail="Waiting for storage adapter" />
        </section>
      )}
    </main>
  );
}

function StatusCard({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return (
    <article className="flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-sm">
      <div className="grid size-11 place-items-center rounded-xl bg-slate-800 text-cyan-300">{icon}</div>
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-0.5 text-sm text-slate-400">{detail}</p>
      </div>
    </article>
  );
}

export default App;
